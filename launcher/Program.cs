namespace PokeBridge;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                using var runtime = new BridgeRuntime();
                runtime.ValidatePackage();
                return 0;
            }
            catch
            {
                return 1;
            }
        }

        using var mutex = new Mutex(true, "Local\\PokeBridge.Launcher", out var firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("PokeBridge is already open.", "PokeBridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 2;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
        return 0;
    }
}
