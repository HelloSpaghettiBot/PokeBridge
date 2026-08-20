using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;

const uint ProcessQueryInformation = 0x0400;
const uint ProcessVmRead = 0x0010;
const uint MemCommit = 0x1000;
const uint PageNoAccess = 0x01;
const uint PageGuard = 0x100;
const int ChunkSize = 1024 * 1024;

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: scan --pid N --x N --y N --output file | filter --pid N --input file --x N --y N --output file | read --pid N --input file");
    return 2;
}

var options = ParseOptions(args.Skip(1));
var pid = RequiredInt(options, "pid");
using var process = Process.GetProcessById(pid);
var handle = Native.OpenProcess(ProcessQueryInformation | ProcessVmRead, false, pid);
if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

try
{
    switch (args[0].ToLowerInvariant())
    {
        case "scan":
        {
            var x = RequiredInt(options, "x");
            var y = RequiredInt(options, "y");
            var output = Required(options, "output");
            var candidates = Scan(handle, x, y);
            WriteCandidates(output, candidates);
            Console.WriteLine($"SCAN pid={pid} x={x} y={y} candidates={candidates.Count} output={Path.GetFullPath(output)}");
            break;
        }
        case "filter":
        {
            var x = RequiredInt(options, "x");
            var y = RequiredInt(options, "y");
            var input = Required(options, "input");
            var output = Required(options, "output");
            var candidates = ReadCandidates(input).Where(candidate => Matches(handle, candidate, x, y)).ToList();
            WriteCandidates(output, candidates);
            Console.WriteLine($"FILTER pid={pid} x={x} y={y} candidates={candidates.Count} output={Path.GetFullPath(output)}");
            break;
        }
        case "read":
        {
            var input = Required(options, "input");
            foreach (var candidate in ReadCandidates(input).Take(1000))
            {
                var (x, y) = ReadPair(handle, candidate);
                Native.VirtualQueryEx(handle, (IntPtr)(long)candidate.Address, out var info, (UIntPtr)Marshal.SizeOf<Mbi>());
                var contextAddress = candidate.Address >= 96 ? candidate.Address - 96 : candidate.Address;
                var context = new byte[224];
                var contextLength = Native.ReadProcessMemory(handle, (IntPtr)(long)contextAddress, context, context.Length, out var contextRead)
                    ? (int)contextRead.ToInt64() : 0;
                Console.WriteLine($"0x{candidate.Address:x} {candidate.Kind} yOffset={candidate.YOffset} x={x} y={y} allocation=0x{info.AllocationBase.ToInt64():x} region=0x{info.BaseAddress.ToInt64():x}+0x{info.RegionSize.ToUInt64():x} type=0x{info.Type:x}");
                Console.WriteLine($"context@0x{contextAddress:x}={Convert.ToHexString(context.AsSpan(0, Math.Max(0, contextLength))).ToLowerInvariant()}");
            }
            break;
        }
        default:
            throw new ArgumentException($"Unknown command: {args[0]}");
    }
}
finally
{
    Native.CloseHandle(handle);
}

return 0;

static List<Candidate> Scan(IntPtr process, int expectedX, int expectedY)
{
    var candidates = new List<Candidate>();
    ulong cursor = 0x10000;
    while (cursor < 0x00007ffffff00000)
    {
        if (Native.VirtualQueryEx(process, (IntPtr)(long)cursor, out var info, (UIntPtr)Marshal.SizeOf<Mbi>()) == UIntPtr.Zero) break;
        var baseAddress = (ulong)info.BaseAddress.ToInt64();
        var regionSize = info.RegionSize.ToUInt64();
        var next = baseAddress + Math.Max(regionSize, 0x1000);
        if (next <= cursor) break;
        cursor = next;
        if (info.State != MemCommit || (info.Protect & (PageNoAccess | PageGuard)) != 0 || regionSize == 0) continue;

        for (ulong offset = 0; offset < regionSize; offset += ChunkSize)
        {
            var requested = (int)Math.Min((ulong)ChunkSize, regionSize - offset);
            var buffer = new byte[requested];
            if (!Native.ReadProcessMemory(process, (IntPtr)(long)(baseAddress + offset), buffer, requested, out var bytesRead) || bytesRead.ToInt64() < 2) continue;
            var length = (int)bytesRead.ToInt64();
            for (var index = 0; index + 4 <= length; index += 2)
            {
                var address = baseAddress + offset + (ulong)index;
                if (BitConverter.ToInt16(buffer, index) == expectedX)
                {
                    foreach (var yOffset in new[] { 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64 })
                    {
                        if (index + yOffset + 2 <= length && BitConverter.ToInt16(buffer, index + yOffset) == expectedY)
                            candidates.Add(new Candidate(address, "i16", yOffset));
                    }
                }
                if ((index & 3) == 0 && BitConverter.ToInt32(buffer, index) == expectedX)
                {
                    foreach (var yOffset in new[] { 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64 })
                    {
                        if (index + yOffset + 4 <= length && BitConverter.ToInt32(buffer, index + yOffset) == expectedY)
                            candidates.Add(new Candidate(address, "i32", yOffset));
                    }
                }
            }
        }
    }
    return candidates.Distinct().ToList();
}

static bool Matches(IntPtr process, Candidate candidate, int expectedX, int expectedY)
{
    try
    {
        var pair = ReadPair(process, candidate);
        return pair.X == expectedX && pair.Y == expectedY;
    }
    catch { return false; }
}

static (int X, int Y) ReadPair(IntPtr process, Candidate candidate)
{
    var width = candidate.Kind == "i16" ? 2 : 4;
    var buffer = new byte[candidate.YOffset + width];
    if (!Native.ReadProcessMemory(process, (IntPtr)(long)candidate.Address, buffer, buffer.Length, out var bytesRead) || bytesRead.ToInt64() != buffer.Length)
        throw new InvalidOperationException("Memory address is no longer readable.");
    return candidate.Kind == "i16"
        ? (BitConverter.ToInt16(buffer, 0), BitConverter.ToInt16(buffer, candidate.YOffset))
        : (BitConverter.ToInt32(buffer, 0), BitConverter.ToInt32(buffer, candidate.YOffset));
}

static Dictionary<string, string> ParseOptions(IEnumerable<string> values)
{
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var items = values.ToArray();
    for (var index = 0; index < items.Length; index += 2)
    {
        if (!items[index].StartsWith("--") || index + 1 >= items.Length) throw new ArgumentException($"Invalid option near {items[index]}");
        result[items[index][2..]] = items[index + 1];
    }
    return result;
}

static string Required(Dictionary<string, string> options, string name) => options.TryGetValue(name, out var value)
    ? value : throw new ArgumentException($"Missing --{name}");

static int RequiredInt(Dictionary<string, string> options, string name) => int.Parse(Required(options, name), CultureInfo.InvariantCulture);

static List<Candidate> ReadCandidates(string path) => JsonSerializer.Deserialize<List<Candidate>>(File.ReadAllText(path)) ?? [];

static void WriteCandidates(string path, List<Candidate> candidates)
{
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
    File.WriteAllText(path, JsonSerializer.Serialize(candidates));
}

record Candidate(ulong Address, string Kind, int YOffset);

[StructLayout(LayoutKind.Sequential)]
struct Mbi
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
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr process, IntPtr baseAddress, [Out] byte[] buffer, int size, out IntPtr bytesRead);

    [DllImport("kernel32.dll")]
    public static extern UIntPtr VirtualQueryEx(IntPtr process, IntPtr address, out Mbi buffer, UIntPtr length);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
}
