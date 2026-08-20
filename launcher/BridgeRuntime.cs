using System.Diagnostics;
using System.Net.Sockets;
using System.Text;

namespace PokeBridge;

internal sealed record StartOptions(
    string Mode,
    string TargetSpecies,
    int LevelMin,
    int LevelMax,
    int TrainingSlot,
    int StepMilliseconds,
    bool AlwaysCatchShiny);

internal sealed class BridgeRuntime : IDisposable
{
    private static readonly AgentDefinition[] Agents =
    [
        new("control", 37666, "PONG", "control-agent.jar", "control-agent.log"),
        new("dex", 37667, "PONG DEX", "dex-agent.jar", "dex-location-agent.log"),
        new("battle", 37668, "PONG BATTLE", "battle-control-agent.jar", "battle-control-agent.log"),
        new("hunt", 37671, "PONG HUNT", "hunt-control-agent.jar", "hunt-control-agent.log"),
        new("species", 37670, "PONG SPECIES", "species-agent.jar", "species-agent.log"),
    ];

    public event Action<string>? Log;
    public event Action<bool>? RunningChanged;

    public string InstallDirectory { get; } = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    public string AppDirectory => Path.Combine(InstallDirectory, "app");
    public string RuntimeDirectory => Path.Combine(InstallDirectory, "runtime");
    public string DataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PokeBridge", "data");
    public string CapturePath => Path.Combine(DataDirectory, "decrypted-gameplay.jsonl");
    public string StatusPath => Path.Combine(DataDirectory, "explorer-status.json");
    public string ActivityLogPath => Path.Combine(DataDirectory, "world-explorer.log");
    public Process? GameProcess { get; private set; }
    public Process? BotProcess { get; private set; }
    public bool IsRunning => BotProcess is { HasExited: false };

    private string NodePath => Path.Combine(RuntimeDirectory, "node", "node.exe");
    private string JavaPath => Path.Combine(RuntimeDirectory, "java", "bin", "java.exe");
    private string AgentDirectory => Path.Combine(RuntimeDirectory, "agents");
    private string AttachJar => Path.Combine(AgentDirectory, "packet-agent.jar");
    private string NativeControlPath => Path.Combine(RuntimeDirectory, "native", "NativeControlAgent.exe");

    public void ValidatePackage() => ValidateInstallation();

    public async Task<Process> EnsureGameAsync(CancellationToken cancellationToken = default)
    {
        ValidateInstallation();
        GameProcess = FindGameProcess();
        if (GameProcess is not null)
        {
            WriteLog($"Official client detected (PID {GameProcess.Id}).");
            return GameProcess;
        }

        var executable = FindGameExecutable()
            ?? throw new FileNotFoundException("PokeMMO.exe was not found. Install PokeMMO or start it manually, then retry.");
        WriteLog("Starting the official PokeMMO client...");
        Process.Start(new ProcessStartInfo(executable)
        {
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(executable)!,
        });
        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await Task.Delay(500, cancellationToken);
            GameProcess = FindGameProcess();
            if (GameProcess is not null)
            {
                WriteLog($"Official client ready (PID {GameProcess.Id}). Log into a character before starting automation.");
                return GameProcess;
            }
        }
        throw new TimeoutException("PokeMMO opened, but its game process was not detected within 45 seconds.");
    }

    public async Task StartAsync(StartOptions options, CancellationToken cancellationToken = default)
    {
        if (IsRunning) return;
        ValidateOptions(options);
        var game = await EnsureGameAsync(cancellationToken);
        PrepareDataDirectory();
        await EnsureAgentStackAsync(game, cancellationToken);

        var runner = Path.Combine(AppDirectory, "scripts", "run-world-explorer.js");
        var start = new ProcessStartInfo(NodePath)
        {
            WorkingDirectory = AppDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in RunnerArguments(runner, game.Id, options)) start.ArgumentList.Add(argument);
        BotProcess = new Process { StartInfo = start, EnableRaisingEvents = true };
        BotProcess.OutputDataReceived += (_, eventArgs) => { if (!string.IsNullOrWhiteSpace(eventArgs.Data)) WriteLog(eventArgs.Data); };
        BotProcess.ErrorDataReceived += (_, eventArgs) => { if (!string.IsNullOrWhiteSpace(eventArgs.Data)) WriteLog("ERROR " + eventArgs.Data); };
        BotProcess.Exited += (_, _) =>
        {
            WriteLog($"Automation stopped (exit code {SafeExitCode(BotProcess)}).");
            RunningChanged?.Invoke(false);
        };
        if (!BotProcess.Start()) throw new InvalidOperationException("The automation process could not be started.");
        BotProcess.BeginOutputReadLine();
        BotProcess.BeginErrorReadLine();
        WriteLog($"{ReadableMode(options.Mode)} started.");
        RunningChanged?.Invoke(true);
    }

    public void Stop()
    {
        var process = BotProcess;
        BotProcess = null;
        if (process is null) return;
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException) { }
        finally
        {
            process.Dispose();
            RunningChanged?.Invoke(false);
            WriteLog("Automation stopped by user.");
        }
    }

    private async Task EnsureAgentStackAsync(Process game, CancellationToken cancellationToken)
    {
        if (game.ProcessName.Equals("PokeMMO", StringComparison.OrdinalIgnoreCase))
        {
            await EnsureNativeControlAsync(game.Id, cancellationToken);
            return;
        }

        var processId = game.Id;
        var controlAvailable = await PingAsync(Agents[0].Port, Agents[0].ExpectedPong, cancellationToken);
        if (!controlAvailable)
        {
            WriteLog("Attaching the encrypted packet bridge...");
            await AttachAsync(processId, AttachJar, CapturePath, cancellationToken);
        }

        foreach (var agent in Agents)
        {
            if (await PingAsync(agent.Port, agent.ExpectedPong, cancellationToken))
            {
                WriteLog($"{agent.Name} control is ready.");
                continue;
            }
            WriteLog($"Attaching {agent.Name} control...");
            var options = $"{Path.Combine(DataDirectory, agent.LogName)},{agent.Port},{DateTime.UtcNow:yyyyMMddHHmmssfff}";
            await AttachAsync(processId, Path.Combine(AgentDirectory, agent.JarName), options, cancellationToken);
            var ready = false;
            for (var attempt = 0; attempt < 20 && !ready; attempt++)
            {
                await Task.Delay(150, cancellationToken);
                ready = await PingAsync(agent.Port, agent.ExpectedPong, cancellationToken);
            }
            if (!ready) throw new InvalidOperationException($"{agent.Name} control did not become ready. Log into a character, then retry.");
        }
    }

    private async Task EnsureNativeControlAsync(int processId, CancellationToken cancellationToken)
    {
        if (await PingAsync(37666, "PONG NATIVE", cancellationToken))
        {
            WriteLog("Native memory control is ready.");
            return;
        }
        if (!File.Exists(NativeControlPath)) throw new FileNotFoundException("The packaged native control bridge is missing.", NativeControlPath);

        WriteLog("Calibrating the native memory bridge...");
        var start = new ProcessStartInfo(NativeControlPath)
        {
            WorkingDirectory = InstallDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in new[]
        {
            "--pid", processId.ToString(),
            "--port", "37666",
            "--graph", Path.Combine(DataDirectory, "world-graph.json"),
            "--status", StatusPath,
        }) start.ArgumentList.Add(argument);

        var native = new Process { StartInfo = start, EnableRaisingEvents = true };
        native.OutputDataReceived += (_, eventArgs) => { if (!string.IsNullOrWhiteSpace(eventArgs.Data)) WriteLog(eventArgs.Data); };
        native.ErrorDataReceived += (_, eventArgs) => { if (!string.IsNullOrWhiteSpace(eventArgs.Data)) WriteLog("NATIVE " + eventArgs.Data); };
        if (!native.Start()) throw new InvalidOperationException("The native memory bridge could not be started.");
        native.BeginOutputReadLine();
        native.BeginErrorReadLine();

        for (var attempt = 0; attempt < 80; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (native.HasExited)
                throw new InvalidOperationException("Native memory calibration failed. Log into a character, then press Start Automation again.");
            if (await PingAsync(37666, "PONG NATIVE", cancellationToken))
            {
                WriteLog("Native memory control is ready.");
                return;
            }
            await Task.Delay(150, cancellationToken);
        }
        try { native.Kill(entireProcessTree: true); } catch { }
        throw new TimeoutException("Native memory calibration timed out. Log into a character, then retry.");
    }

    private async Task AttachAsync(int processId, string agentJar, string options, CancellationToken cancellationToken)
    {
        if (!File.Exists(agentJar)) throw new FileNotFoundException("A packaged agent is missing.", agentJar);
        var start = new ProcessStartInfo(JavaPath)
        {
            WorkingDirectory = InstallDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in new[] { "--add-modules", "jdk.attach", "-cp", AttachJar, "lab.agent.AttachPacketAgent", processId.ToString(), agentJar, options })
            start.ArgumentList.Add(argument);
        using var attach = Process.Start(start) ?? throw new InvalidOperationException("The Java attach helper could not start.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try { await attach.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            try { attach.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException("Attaching to PokeMMO timed out.");
        }
        var stdout = await attach.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = await attach.StandardError.ReadToEndAsync(cancellationToken);
        if (attach.ExitCode != 0)
        {
            var detail = string.Join(" ", new[] { stderr.Trim(), stdout.Trim() }.Where(value => value.Length > 0));
            throw new InvalidOperationException($"Agent attach failed: {detail}. Run PokeBridge under the same Windows account as PokeMMO.");
        }
    }

    private static async Task<bool> PingAsync(int port, string expected, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(650));
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync("127.0.0.1", port, timeout.Token);
            await using var stream = client.GetStream();
            await stream.WriteAsync(Encoding.UTF8.GetBytes("PING\n"), timeout.Token);
            using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: false);
            var response = await reader.ReadLineAsync(timeout.Token);
            return response?.StartsWith("OK ", StringComparison.Ordinal) == true && response.Contains(expected, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private IEnumerable<string> RunnerArguments(string runner, int processId, StartOptions options)
    {
        yield return runner;
        foreach (var pair in new (string Name, string Value)[]
        {
            ("capture", CapturePath),
            ("graph", Path.Combine(DataDirectory, "world-graph.json")),
            ("encounters", Path.Combine(DataDirectory, "encounter-dex.json")),
            ("centers", Path.Combine(DataDirectory, "pokemon-centers.json")),
            ("campaign", Path.Combine(DataDirectory, "kanto-campaign.json")),
            ("species-index", Path.Combine(DataDirectory, "client-species-index.json")),
            ("status", StatusPath),
            ("log", ActivityLogPath),
            ("client-pid", processId.ToString()),
            ("mode", options.Mode),
            ("level-min", options.LevelMin.ToString()),
            ("level-max", options.LevelMax.ToString()),
            ("training-slot", options.TrainingSlot.ToString()),
            ("step-ms", options.StepMilliseconds.ToString()),
            ("always-catch-shiny", options.AlwaysCatchShiny.ToString().ToLowerInvariant()),
        })
        {
            yield return "--" + pair.Name;
            yield return pair.Value;
        }
        if (!string.IsNullOrWhiteSpace(options.TargetSpecies))
        {
            yield return "--target-species";
            yield return options.TargetSpecies.Trim();
        }
    }

    private void PrepareDataDirectory()
    {
        Directory.CreateDirectory(DataDirectory);
        var seeds = Path.Combine(AppDirectory, "captures");
        foreach (var name in new[] { "world-graph.json", "encounter-dex.json", "pokemon-centers.json", "client-species-index.json" })
        {
            var destination = Path.Combine(DataDirectory, name);
            if (!File.Exists(destination)) File.Copy(Path.Combine(seeds, name), destination);
        }
        if (!File.Exists(CapturePath)) File.WriteAllText(CapturePath, string.Empty);
        WriteLog($"Data directory: {DataDirectory}");
    }

    private void ValidateInstallation()
    {
        var required = new List<string>
        {
            NodePath,
            JavaPath,
            AttachJar,
            NativeControlPath,
            Path.Combine(AppDirectory, "package.json"),
            Path.Combine(AppDirectory, "scripts", "run-world-explorer.js"),
        };
        required.AddRange(Agents.Select(agent => Path.Combine(AgentDirectory, agent.JarName)));
        required.AddRange(new[] { "world-graph.json", "encounter-dex.json", "pokemon-centers.json", "client-species-index.json" }
            .Select(name => Path.Combine(AppDirectory, "captures", name)));
        foreach (var file in required)
            if (!File.Exists(file)) throw new FileNotFoundException("This PokeBridge release is incomplete. Extract the full release folder before running it.", file);
    }

    private static void ValidateOptions(StartOptions options)
    {
        if (options.Mode is not ("explore" or "train" or "hunt" or "shiny" or "badges")) throw new ArgumentException("Choose a valid activity.");
        if (options.Mode == "hunt" && string.IsNullOrWhiteSpace(options.TargetSpecies)) throw new ArgumentException("Choose a Pokémon name or species number to hunt.");
        if (options.LevelMin < 1 || options.LevelMax < options.LevelMin || options.LevelMax > 100) throw new ArgumentException("Use a valid level range from 1 to 100.");
        if (options.TrainingSlot is < 0 or > 6) throw new ArgumentException("Choose Auto or party slot 1 through 6 for EXP training.");
        if (options.StepMilliseconds is < 150 or > 1500) throw new ArgumentException("Walking pace must be between 150 and 1500 ms.");
    }

    private static Process? FindGameProcess() => Process.GetProcesses()
        .Where(process => process.ProcessName.Equals("PokeMMO", StringComparison.OrdinalIgnoreCase)
            || process.ProcessName.Equals("javaw", StringComparison.OrdinalIgnoreCase)
            || process.ProcessName.Equals("java", StringComparison.OrdinalIgnoreCase))
        .Select(process => (Process: process, Path: SafeModulePath(process)))
        .Where(item => item.Path?.Contains("PokeMMO", StringComparison.OrdinalIgnoreCase) == true)
        .OrderByDescending(item => SafeStartTime(item.Process))
        .Select(item => item.Process)
        .FirstOrDefault();

    private static string? FindGameExecutable()
    {
        var explicitHome = Environment.GetEnvironmentVariable("POKEMMO_HOME");
        var roots = new[]
        {
            explicitHome,
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        };
        return roots.Where(root => !string.IsNullOrWhiteSpace(root))
            .SelectMany(root => new[]
            {
                Path.Combine(root!, "PokeMMO.exe"),
                Path.Combine(root!, "PokeMMO", "PokeMMO.exe"),
            })
            .FirstOrDefault(File.Exists);
    }

    private static string? SafeModulePath(Process process) { try { return process.MainModule?.FileName; } catch { return null; } }
    private static DateTime SafeStartTime(Process process) { try { return process.StartTime; } catch { return DateTime.MinValue; } }
    private static int SafeExitCode(Process? process) { try { return process?.ExitCode ?? -1; } catch { return -1; } }
    private static string ReadableMode(string mode) => mode switch { "explore" => "Explore & map", "train" => "Training", "hunt" => "Species hunt", "shiny" => "Shiny hunt", "badges" => "Kanto badge campaign", _ => mode };
    private void WriteLog(string message) => Log?.Invoke($"{DateTime.Now:HH:mm:ss}  {message}");

    public void Dispose() => Stop();
    private sealed record AgentDefinition(string Name, int Port, string ExpectedPong, string JarName, string LogName);
}
