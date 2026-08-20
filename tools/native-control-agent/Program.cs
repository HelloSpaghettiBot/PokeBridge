using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

var options = ParseOptions(args);
var pid = RequiredInt(options, "pid");
var port = OptionalInt(options, "port", 37666);
var graphPath = Path.GetFullPath(Required(options, "graph"));
var statusPath = options.TryGetValue("status", out var configuredStatus) ? Path.GetFullPath(configuredStatus) : null;
var seed = ReadSeed(statusPath);
var map = options.GetValueOrDefault("map", seed?.Map ?? throw new ArgumentException("Missing --map or a usable --status world record"));
var name = options.GetValueOrDefault("name", seed?.Name ?? map).Replace(' ', '_');
var direction = OptionalInt(options, "direction", seed?.Direction ?? 0);

using var game = Process.GetProcessById(pid);
var process = Native.OpenProcess(0x0400 | 0x0010, false, pid);
if (process == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
using var graph = JsonDocument.Parse(File.ReadAllText(graphPath));
var lastKnown = seed is null ? (Position?)null : new Position(seed.Value.X, seed.Value.Y);
var address = options.TryGetValue("address", out var configuredAddress)
    ? ParseAddress(configuredAddress)
    : LocateCoordinateAddress(process, graph.RootElement, map, lastKnown).Address;
lastKnown = ReadPosition(process, address);
var gate = new SemaphoreSlim(1, 1);
var listener = new TcpListener(IPAddress.Loopback, port);
listener.Start();
Console.WriteLine($"NATIVE_CONTROL_READY pid={pid} port={port} address=0x{address:x} map={map} x={lastKnown.Value.X} y={lastKnown.Value.Y}");

try
{
    while (!game.HasExited)
    {
        var client = await listener.AcceptTcpClientAsync();
        _ = Task.Run(async () =>
        {
            using (client)
            {
                try
                {
                    using var reader = new StreamReader(client.GetStream(), Encoding.UTF8, leaveOpen: true);
                    await using var writer = new StreamWriter(client.GetStream(), new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
                    var line = (await reader.ReadLineAsync())?.Trim() ?? string.Empty;
                    await gate.WaitAsync();
                    try
                    {
                        await writer.WriteLineAsync(await Handle(line));
                    }
                    finally { gate.Release(); }
                }
                catch (Exception error)
                {
                    try
                    {
                        await using var writer = new StreamWriter(client.GetStream(), new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
                        await writer.WriteLineAsync("ERR " + error.Message.Replace('\r', ' ').Replace('\n', ' '));
                    }
                    catch { }
                }
            }
        });
    }
}
finally
{
    listener.Stop();
    Native.CloseHandle(process);
}

return;

async Task<string> Handle(string line)
{
    var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
    var command = parts.FirstOrDefault()?.ToUpperInvariant() ?? string.Empty;
    var before = ReadVerifiedPosition();
    switch (command)
    {
        case "PING": return $"OK PONG NATIVE pid={pid}";
        case "STATE": return "OK OVERWORLD";
        case "WORLD": return $"OK WORLD map={map} name={name} x={before.X} y={before.Y} direction={direction}";
        case "PROGRESS": return "OK PROGRESS levelCap=26 native=true";
        case "MAPGRID": return BuildMapGrid(graph.RootElement, map, name);
        case "TILE": return "ERR Native terrain hook is not calibrated";
        case "INVENTORY": return "OK INVENTORY native=true";
        case "IDENTIFY": return "ERR No active native battle identity";
        case "KEY":
        {
            if (parts.Length is < 2 or > 5) return "ERR KEY name [repeat] [durationMs] [betweenMs]";
            var repeat = parts.Length > 2 && int.TryParse(parts[2], out var parsedRepeat) ? parsedRepeat : 1;
            var durationMs = parts.Length > 3 && int.TryParse(parts[3], out var parsedDuration) ? parsedDuration : 120;
            var betweenMs = parts.Length > 4 && int.TryParse(parts[4], out var parsedBetween) ? parsedBetween : 120;
            if (repeat is < 1 or > 20 || durationMs is < 30 or > 2000 || betweenMs is < 0 or > 5000)
                return "ERR Invalid key timing";
            for (var index = 0; index < repeat; index++)
            {
                SendNamedKey(game, parts[1], durationMs);
                if (index + 1 < repeat) await Task.Delay(betweenMs);
            }
            return $"OK KEY_SENT name={parts[1].ToUpperInvariant()} repeat={repeat}";
        }
        case "MOVE":
        {
            if (parts.Length != 2 || !int.TryParse(parts[1], out var requested) || requested is < 0 or > 3)
                return "ERR MOVE requires direction 0..3";
            direction = requested;
            SendDirection(game, requested);
            await Task.Delay(700);
            var after = ReadVerifiedPosition(before);
            if (after != before) UpdateMapFromGraph(graph.RootElement, before, after, requested, ref map, ref name);
            lastKnown = after;
            return after == before
                ? $"OK BLOCKED map={map} x={after.X} y={after.Y} direction={direction}"
                : $"OK MOVED map={map} x={after.X} y={after.Y} direction={direction}";
        }
        default: return "ERR Unknown command";
    }
}

Position ReadVerifiedPosition(Position? expected = null)
{
    try
    {
        var current = ReadPosition(process, address);
        if (HasMapSignature(process, address, map) && IsCoordinatePlausible(graph.RootElement, map, current))
        {
            lastKnown = current;
            return current;
        }
    }
    catch { }

    var preferred = expected ?? lastKnown;
    var located = LocateCoordinateAddress(process, graph.RootElement, map, preferred);
    address = located.Address;
    lastKnown = located.Position;
    Console.WriteLine($"NATIVE_CONTROL_RELOCATED address=0x{address:x} map={map} x={located.Position.X} y={located.Position.Y}");
    return located.Position;
}

static string BuildMapGrid(JsonElement root, string map, string fallbackName)
{
    if (!root.TryGetProperty("maps", out var maps) || !maps.TryGetProperty(map, out var record)
        || !record.TryGetProperty("tiles", out var tiles) || tiles.ValueKind != JsonValueKind.Array)
        return "ERR No learned map grid";
    var width = record.TryGetProperty("width", out var widthValue) ? widthValue.GetInt32() : 1;
    var height = record.TryGetProperty("height", out var heightValue) ? heightValue.GetInt32() : 1;
    var mapName = record.TryGetProperty("name", out var nameValue) ? nameValue.GetString() ?? fallbackName : fallbackName;
    var records = new List<string>();
    foreach (var tile in tiles.EnumerateArray())
    {
        if (tile.ValueKind != JsonValueKind.Array || tile.GetArrayLength() < 7) continue;
        var values = tile.EnumerateArray().Select(value => value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.GetRawText()).ToArray();
        records.Add(string.Join(',', values.Take(8)));
    }
    return $"OK MAPGRID map={map} name={mapName.Replace(' ', '_')} width={width} height={height} tiles={string.Join(';', records)}";
}

static void UpdateMapFromGraph(JsonElement root, Position before, Position after, int direction, ref string map, ref string name)
{
    if (!root.TryGetProperty("edges", out var edges)) return;
    var key = $"{map}@{before.X},{before.Y}";
    if (!edges.TryGetProperty(key, out var outgoing) || outgoing.ValueKind != JsonValueKind.Array) return;
    foreach (var edge in outgoing.EnumerateArray())
    {
        if (!edge.TryGetProperty("direction", out var directionValue) || directionValue.GetInt32() != direction) continue;
        var destination = edge.GetProperty("to").GetString() ?? string.Empty;
        var at = destination.LastIndexOf('@');
        if (at < 0) continue;
        var coordinates = destination[(at + 1)..].Split(',');
        if (coordinates.Length != 2 || !int.TryParse(coordinates[0], out var x) || !int.TryParse(coordinates[1], out var y)) continue;
        if (x != after.X || y != after.Y) continue;
        map = destination[..at];
        if (root.TryGetProperty("maps", out var maps) && maps.TryGetProperty(map, out var record) && record.TryGetProperty("name", out var value))
            name = (value.GetString() ?? map).Replace(' ', '_');
        return;
    }
}

static Position ReadPosition(IntPtr process, ulong address)
{
    var buffer = new byte[4];
    if (!Native.ReadProcessMemory(process, (IntPtr)(long)address, buffer, buffer.Length, out var read) || read.ToInt64() != buffer.Length)
        throw new InvalidOperationException("Native world coordinate address is unavailable");
    return new Position(BitConverter.ToInt16(buffer, 0), BitConverter.ToInt16(buffer, 2));
}

static bool HasMapSignature(IntPtr process, ulong address, string map)
{
    var signature = MapSignature(map);
    if (signature is null) return false;
    var buffer = new byte[7];
    return Native.ReadProcessMemory(process, (IntPtr)(long)address, buffer, buffer.Length, out var read)
        && read.ToInt64() == buffer.Length
        && buffer[4] == signature[0] && buffer[5] == signature[1] && buffer[6] == signature[2];
}

static LocatedCoordinate LocateCoordinateAddress(IntPtr process, JsonElement graph, string map, Position? preferred)
{
    var signature = MapSignature(map) ?? throw new InvalidOperationException($"Map key {map} cannot provide a native signature");
    var matches = new List<LocatedCoordinate>();
    ulong cursor = 0x10000;
    while (cursor < 0x00007ffffff00000)
    {
        if (Native.VirtualQueryEx(process, (IntPtr)(long)cursor, out var info, (UIntPtr)Marshal.SizeOf<MemoryBasicInformation>()) == UIntPtr.Zero) break;
        var baseAddress = (ulong)info.BaseAddress.ToInt64();
        var regionSize = info.RegionSize.ToUInt64();
        var next = baseAddress + Math.Max(regionSize, 0x1000);
        if (next <= cursor) break;
        cursor = next;
        if (info.State != 0x1000 || (info.Protect & (0x01u | 0x100u)) != 0 || regionSize == 0) continue;

        const int chunkSize = 1024 * 1024;
        for (ulong offset = 0; offset < regionSize; offset += chunkSize)
        {
            var requested = (int)Math.Min((ulong)chunkSize, regionSize - offset);
            var buffer = new byte[requested];
            if (!Native.ReadProcessMemory(process, (IntPtr)(long)(baseAddress + offset), buffer, requested, out var bytesRead)) continue;
            var length = (int)bytesRead.ToInt64();
            for (var index = 0; index + 7 <= length; index += 2)
            {
                if (buffer[index + 4] != signature[0] || buffer[index + 5] != signature[1] || buffer[index + 6] != signature[2]) continue;
                var position = new Position(BitConverter.ToInt16(buffer, index), BitConverter.ToInt16(buffer, index + 2));
                if (!IsCoordinatePlausible(graph, map, position)) continue;
                matches.Add(new LocatedCoordinate(baseAddress + offset + (ulong)index, position));
            }
        }
    }

    var exact = preferred is null ? [] : matches.Where(match => match.Position == preferred.Value).ToList();
    var candidates = exact.Count > 0 ? exact : matches;
    if (candidates.Count == 0)
        throw new InvalidOperationException(preferred is null
            ? $"Native world coordinates for map {map} were not found; log into a character and retry"
            : $"Native world coordinates near {preferred.Value.X},{preferred.Value.Y} on map {map} were not found");
    if (candidates.Select(candidate => candidate.Position).Distinct().Count() > 1 && exact.Count == 0)
        throw new InvalidOperationException($"Native coordinate calibration is ambiguous on map {map}; refresh the saved status from a logged-in character");
    return candidates.OrderBy(candidate => candidate.Address).First();
}

static bool IsCoordinatePlausible(JsonElement root, string map, Position position)
{
    if (position.X < 0 || position.Y < 0 || !root.TryGetProperty("maps", out var maps) || !maps.TryGetProperty(map, out var record)) return false;
    var width = record.TryGetProperty("width", out var widthValue) ? widthValue.GetInt32() : 0;
    var height = record.TryGetProperty("height", out var heightValue) ? heightValue.GetInt32() : 0;
    return position.X < width && position.Y < height;
}

static byte[]? MapSignature(string map)
{
    var parts = map.Split(':');
    if (parts.Length < 3 || !byte.TryParse(parts[0], out var region) || !byte.TryParse(parts[1], out var group) || !byte.TryParse(parts[2], out var number)) return null;
    return [region, group, number];
}

static SeedWorld? ReadSeed(string? statusPath)
{
    if (string.IsNullOrWhiteSpace(statusPath) || !File.Exists(statusPath)) return null;
    try
    {
        using var status = JsonDocument.Parse(File.ReadAllText(statusPath));
        if (!status.RootElement.TryGetProperty("world", out var world) || world.ValueKind != JsonValueKind.Object) return null;
        return new SeedWorld(
            world.GetProperty("map").GetString() ?? string.Empty,
            world.TryGetProperty("name", out var name) ? name.GetString() ?? string.Empty : string.Empty,
            world.GetProperty("x").GetInt32(),
            world.GetProperty("y").GetInt32(),
            world.TryGetProperty("direction", out var direction) ? direction.GetInt32() : 0);
    }
    catch { return null; }
}

static void SendDirection(Process game, int direction)
{
    var scanCode = direction switch { 0 => (ushort)0x50, 1 => (ushort)0x48, 2 => (ushort)0x4B, 3 => (ushort)0x4D, _ => throw new ArgumentOutOfRangeException(nameof(direction)) };
    Native.SetForegroundWindow(game.MainWindowHandle);
    Thread.Sleep(100);
    Native.SendScanCode(scanCode, true, false);
    Thread.Sleep(150);
    Native.SendScanCode(scanCode, true, true);
}

static void SendNamedKey(Process game, string name, int durationMs)
{
    var (scanCode, extended) = name.ToUpperInvariant() switch
    {
        "UP" => ((ushort)0x48, true), "DOWN" => ((ushort)0x50, true),
        "LEFT" => ((ushort)0x4B, true), "RIGHT" => ((ushort)0x4D, true),
        "A" or "Z" => ((ushort)0x2C, false), "B" or "X" => ((ushort)0x2D, false),
        "C" => ((ushort)0x2E, false), "ENTER" => ((ushort)0x1C, false),
        _ => throw new ArgumentException($"Unknown key: {name}"),
    };
    Native.SetForegroundWindow(game.MainWindowHandle);
    Thread.Sleep(80);
    Native.SendScanCode(scanCode, extended, false);
    Thread.Sleep(durationMs);
    Native.SendScanCode(scanCode, extended, true);
}

static Dictionary<string, string> ParseOptions(string[] args)
{
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (var index = 0; index < args.Length; index += 2)
    {
        if (!args[index].StartsWith("--") || index + 1 >= args.Length) throw new ArgumentException($"Invalid option near {args[index]}");
        result[args[index][2..]] = args[index + 1];
    }
    return result;
}

static string Required(Dictionary<string, string> options, string name) => options.TryGetValue(name, out var value) ? value : throw new ArgumentException($"Missing --{name}");
static int RequiredInt(Dictionary<string, string> options, string name) => int.Parse(Required(options, name), CultureInfo.InvariantCulture);
static int OptionalInt(Dictionary<string, string> options, string name, int fallback) => options.TryGetValue(name, out var value) ? int.Parse(value, CultureInfo.InvariantCulture) : fallback;
static ulong ParseAddress(string value) => ulong.Parse(value.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? value[2..] : value, NumberStyles.HexNumber, CultureInfo.InvariantCulture);

readonly record struct Position(int X, int Y);
readonly record struct LocatedCoordinate(ulong Address, Position Position);
readonly record struct SeedWorld(string Map, string Name, int X, int Y, int Direction);

[StructLayout(LayoutKind.Sequential)]
struct MemoryBasicInformation
{
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public ushort PartitionId;
    public UIntPtr RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
}

static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit, Size = 32)]
    public struct InputUnion { [FieldOffset(0)] public KeyboardInput Keyboard; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KeyboardInput { public ushort VirtualKey; public ushort ScanCode; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool ReadProcessMemory(IntPtr process, IntPtr address, [Out] byte[] buffer, int size, out IntPtr bytesRead);
    [DllImport("kernel32.dll")] public static extern UIntPtr VirtualQueryEx(IntPtr process, IntPtr address, out MemoryBasicInformation buffer, UIntPtr length);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);

    public static void SendScanCode(ushort scanCode, bool extended, bool keyUp)
    {
        const uint Keyboard = 1, Extended = 0x0001, KeyUp = 0x0002, ScanCode = 0x0008;
        var flags = ScanCode | (extended ? Extended : 0) | (keyUp ? KeyUp : 0);
        var input = new Input { Type = Keyboard, Data = new InputUnion { Keyboard = new KeyboardInput { ScanCode = scanCode, Flags = flags } } };
        if (SendInput(1, [input], Marshal.SizeOf<Input>()) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
}
