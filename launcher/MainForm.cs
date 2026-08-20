using System.Diagnostics;
using System.Text.Json;

namespace PokeBridge;

internal sealed class MainForm : Form
{
    private static readonly Color Background = Color.FromArgb(12, 17, 24);
    private static readonly Color Panel = Color.FromArgb(20, 28, 38);
    private static readonly Color Input = Color.FromArgb(28, 39, 52);
    private static readonly Color TextPrimary = Color.FromArgb(235, 241, 247);
    private static readonly Color TextMuted = Color.FromArgb(154, 170, 186);
    private static readonly Color Accent = Color.FromArgb(255, 79, 112);
    private static readonly Color Success = Color.FromArgb(70, 205, 145);

    private readonly BridgeRuntime runtime = new();
    private readonly ComboBox modeBox = new();
    private readonly TextBox targetBox = new();
    private readonly NumericUpDown levelMinBox = new();
    private readonly NumericUpDown levelMaxBox = new();
    private readonly ComboBox trainingSlotBox = new();
    private readonly NumericUpDown paceBox = new();
    private readonly CheckBox shinyBox = new();
    private readonly Button clientButton = new();
    private readonly Button startButton = new();
    private readonly Button stopButton = new();
    private readonly Label connectionLabel = new();
    private readonly Label activityLabel = new();
    private readonly Label locationLabel = new();
    private readonly Label battleLabel = new();
    private readonly Label totalsLabel = new();
    private readonly RichTextBox logBox = new();
    private readonly System.Windows.Forms.Timer statusTimer = new() { Interval = 750 };
    private CancellationTokenSource? operationCancellation;
    private bool busy;

    public MainForm()
    {
        Text = "PokeBridge — Local Automation";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(940, 650);
        Size = new Size(1120, 760);
        BackColor = Background;
        ForeColor = TextPrimary;
        Font = new Font("Segoe UI", 10F);
        AutoScaleMode = AutoScaleMode.Dpi;

        Controls.Add(BuildLayout());
        runtime.Log += message => Ui(() => AppendLog(message));
        runtime.RunningChanged += running => Ui(() => SetRunning(running));
        modeBox.SelectedIndexChanged += (_, _) => UpdateModeFields();
        clientButton.Click += async (_, _) => await OpenClientAsync();
        startButton.Click += async (_, _) => await StartAutomationAsync();
        stopButton.Click += (_, _) => runtime.Stop();
        statusTimer.Tick += (_, _) => RefreshStatus();
        FormClosing += (_, _) =>
        {
            operationCancellation?.Cancel();
            runtime.Dispose();
        };
        Shown += async (_, _) =>
        {
            statusTimer.Start();
            await OpenClientAsync();
        };

        modeBox.SelectedIndex = 0;
        trainingSlotBox.SelectedIndex = 0;
        shinyBox.Checked = true;
        levelMinBox.Value = 1;
        levelMaxBox.Value = 100;
        paceBox.Value = 250;
        SetRunning(false);
        AppendLog("PokeBridge is ready. The official client will be detected or opened automatically.");
    }

    private Control BuildLayout()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(22),
            ColumnCount = 2,
            RowCount = 3,
            BackColor = Background,
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 70));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 30));

        var titlePanel = new Panel { Dock = DockStyle.Fill, BackColor = Background };
        titlePanel.Controls.Add(new Label
        {
            Text = "POKEBRIDGE",
            AutoSize = true,
            Location = new Point(0, 1),
            Font = new Font("Segoe UI Semibold", 19F),
            ForeColor = TextPrimary,
        });
        connectionLabel.AutoSize = true;
        connectionLabel.Location = new Point(2, 40);
        connectionLabel.ForeColor = TextMuted;
        connectionLabel.Text = "Checking the official client…";
        titlePanel.Controls.Add(connectionLabel);
        root.Controls.Add(titlePanel, 0, 0);
        root.SetColumnSpan(titlePanel, 2);

        root.Controls.Add(BuildSpacedConfigurationCard(), 0, 1);
        root.Controls.Add(BuildStatusCard(), 1, 1);

        var logCard = Card("ACTIVITY LOG");
        logBox.Dock = DockStyle.Fill;
        logBox.ReadOnly = true;
        logBox.BorderStyle = BorderStyle.None;
        logBox.BackColor = Color.FromArgb(10, 15, 21);
        logBox.ForeColor = Color.FromArgb(196, 210, 222);
        logBox.Font = new Font("Cascadia Mono", 9F);
        logBox.DetectUrls = false;
        logCard.Controls.Add(logBox);
        logBox.BringToFront();
        root.Controls.Add(logCard, 0, 2);
        root.SetColumnSpan(logCard, 2);
        return root;
    }

    private Control BuildSpacedConfigurationCard()
    {
        var card = Card("ACTIVITY");
        card.Padding = new Padding(22, 48, 22, 18);

        ConfigureDropDown(modeBox, "Training", "Hunt a species", "Shiny hunting", "Explore and map", "Kanto badge campaign");
        ConfigureTextBox(targetBox, "Name or species number");
        ConfigureNumber(levelMinBox, 1, 100, 1);
        ConfigureNumber(levelMaxBox, 1, 100, 100);
        ConfigureDropDown(trainingSlotBox, "Auto — lowest level", "Party slot 1", "Party slot 2", "Party slot 3", "Party slot 4", "Party slot 5", "Party slot 6");
        ConfigureNumber(paceBox, 150, 1500, 250, 10);
        shinyBox.Text = "Always catch shiny encounters";
        shinyBox.ForeColor = TextPrimary;
        shinyBox.FlatStyle = FlatStyle.Flat;
        StyleButton(clientButton, "OPEN / DETECT CLIENT", Input);
        StyleButton(startButton, "START AUTOMATION", Accent);
        StyleButton(stopButton, "STOP", Color.FromArgb(58, 72, 87));
        clientButton.Dock = DockStyle.None;
        startButton.Dock = DockStyle.None;
        stopButton.Dock = DockStyle.None;

        var modeLabel = SpacedFieldLabel("Mode");
        var targetLabel = SpacedFieldLabel("Pokémon to hunt");
        var minimumLabel = SpacedFieldLabel("Minimum level");
        var maximumLabel = SpacedFieldLabel("Maximum level");
        var trainingLabel = SpacedFieldLabel("Pokémon receiving EXP");
        var paceLabel = SpacedFieldLabel("Walking pace (milliseconds)");
        var surface = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        surface.Controls.AddRange(new Control[]
        {
            modeLabel, modeBox, targetLabel, targetBox,
            minimumLabel, maximumLabel, levelMinBox, levelMaxBox,
            trainingLabel, trainingSlotBox, paceLabel, paceBox, shinyBox,
            clientButton, startButton, stopButton,
        });
        surface.Layout += (_, _) =>
        {
            var width = Math.Max(300, surface.ClientSize.Width - 2);
            const int horizontalGap = 16;
            const int verticalGap = 9;
            const int labelHeight = 16;
            const int inputHeight = 28;
            var y = 0;

            modeLabel.SetBounds(0, y, width, labelHeight);
            modeBox.SetBounds(0, y + 20, width, inputHeight);
            y += labelHeight + inputHeight + verticalGap;

            targetLabel.SetBounds(0, y, width, labelHeight);
            targetBox.SetBounds(0, y + 20, width, inputHeight);
            y += labelHeight + inputHeight + verticalGap;

            var half = (width - horizontalGap) / 2;
            minimumLabel.SetBounds(0, y, half, labelHeight);
            maximumLabel.SetBounds(half + horizontalGap, y, half, labelHeight);
            levelMinBox.SetBounds(0, y + 20, half, inputHeight);
            levelMaxBox.SetBounds(half + horizontalGap, y + 20, half, inputHeight);
            y += labelHeight + inputHeight + verticalGap;

            trainingLabel.SetBounds(0, y, half, labelHeight);
            paceLabel.SetBounds(half + horizontalGap, y, half, labelHeight);
            trainingSlotBox.SetBounds(0, y + 19, half, inputHeight);
            paceBox.SetBounds(half + horizontalGap, y + 19, half, inputHeight);
            y += labelHeight + inputHeight + verticalGap + 2;

            shinyBox.SetBounds(0, y, width, 28);
            y += 36;

            clientButton.SetBounds(0, y, width, 38);
            y += 50;
            startButton.SetBounds(0, y, half, 42);
            stopButton.SetBounds(half + horizontalGap, y, half, 42);
            surface.AutoScrollMinSize = new Size(0, y + 44);
        };

        card.Controls.Add(surface);
        surface.BringToFront();
        return card;
    }

    private static Label SpacedFieldLabel(string text) => new()
    {
        Text = text,
        ForeColor = TextMuted,
        Font = new Font("Segoe UI Semibold", 8.5F),
        TextAlign = ContentAlignment.BottomLeft,
    };

    private Control BuildConfigurationCard()
    {
        var card = Card("ACTIVITY");
        card.Padding = new Padding(18, 40, 18, 12);
        var fields = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 6 };
        fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        fields.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        fields.RowStyles.Add(new RowStyle(SizeType.Percent, 50));

        ConfigureDropDown(modeBox, "Training", "Hunt a species", "Shiny hunting", "Explore and map", "Kanto badge campaign");
        var modeField = Field("Mode", modeBox);
        fields.Controls.Add(modeField, 0, 0);
        fields.SetColumnSpan(modeField, 2);
        ConfigureTextBox(targetBox, "Name or species number");
        var targetField = Field("Pokémon to hunt", targetBox);
        fields.Controls.Add(targetField, 0, 1);
        fields.SetColumnSpan(targetField, 2);

        ConfigureNumber(levelMinBox, 1, 100, 1);
        ConfigureNumber(levelMaxBox, 1, 100, 100);
        fields.Controls.Add(Field("Minimum level", levelMinBox), 0, 2);
        fields.Controls.Add(Field("Maximum level", levelMaxBox), 1, 2);

        ConfigureNumber(paceBox, 150, 1500, 250, 10);
        fields.Controls.Add(Field("Walking pace (ms)", paceBox), 0, 3);
        shinyBox.Text = "Always catch shiny encounters";
        shinyBox.Dock = DockStyle.Fill;
        shinyBox.ForeColor = TextPrimary;
        shinyBox.Padding = new Padding(8, 5, 0, 0);
        shinyBox.FlatStyle = FlatStyle.Flat;
        fields.Controls.Add(shinyBox, 1, 3);

        StyleButton(clientButton, "OPEN / DETECT CLIENT", Input);
        StyleButton(startButton, "START AUTOMATION", Accent);
        StyleButton(stopButton, "STOP", Color.FromArgb(58, 72, 87));
        fields.Controls.Add(clientButton, 0, 4);
        fields.SetColumnSpan(clientButton, 2);
        fields.Controls.Add(startButton, 0, 5);
        fields.Controls.Add(stopButton, 1, 5);
        card.Controls.Add(fields);
        fields.BringToFront();
        return card;
    }

    private Control BuildStatusCard()
    {
        var card = Card("CURRENT STATUS");
        card.Padding = new Padding(22, 44, 22, 14);
        var content = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5 };
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 15));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 18));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 22));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 27));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 18));
        ConfigureStatus(activityLabel, "Idle", 17F, TextMuted);
        ConfigureStatus(locationLabel, "No position yet", 11F, TextPrimary);
        ConfigureStatus(battleLabel, "No active battle", 11F, TextPrimary);
        ConfigureStatus(totalsLabel, "Maps 0   •   Steps 0   •   Battles 0   •   Centers 0", 11F, TextMuted);
        content.Controls.Add(activityLabel, 0, 0);
        content.Controls.Add(StatusBlock("LOCATION", locationLabel), 0, 1);
        content.Controls.Add(StatusBlock("BATTLE", battleLabel), 0, 2);
        content.Controls.Add(StatusBlock("PROGRESS", totalsLabel), 0, 3);

        var dataButton = new Button();
        StyleButton(dataButton, "OPEN DATA & LOGS", Input);
        dataButton.Click += (_, _) =>
        {
            Directory.CreateDirectory(runtime.DataDirectory);
            Process.Start(new ProcessStartInfo(runtime.DataDirectory) { UseShellExecute = true });
        };
        content.Controls.Add(dataButton, 0, 4);
        card.Controls.Add(content);
        content.BringToFront();
        return card;
    }

    private static Panel Card(string title)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Panel, Padding = new Padding(16, 44, 16, 14), Margin = new Padding(7) };
        panel.Controls.Add(new Label
        {
            Text = title,
            AutoSize = true,
            Location = new Point(17, 14),
            Font = new Font("Segoe UI Semibold", 9F),
            ForeColor = TextMuted,
        });
        return panel;
    }

    private static Control Field(string label, Control control)
    {
        var field = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            Padding = new Padding(4, 3, 4, 3),
            Margin = Padding.Empty,
        };
        field.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        field.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        field.Controls.Add(new Label { Text = label, Dock = DockStyle.Fill, ForeColor = TextMuted, Font = new Font("Segoe UI", 8F) }, 0, 0);
        control.Dock = DockStyle.Fill;
        field.Controls.Add(control, 0, 1);
        return field;
    }

    private static Control StatusBlock(string heading, Label value)
    {
        var block = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = Padding.Empty };
        block.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        block.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        block.Controls.Add(new Label { Text = heading, Dock = DockStyle.Fill, ForeColor = TextMuted, Font = new Font("Segoe UI Semibold", 8F) }, 0, 0);
        value.Dock = DockStyle.Fill;
        block.Controls.Add(value, 0, 1);
        return block;
    }

    private static void ConfigureDropDown(ComboBox box, params string[] items)
    {
        box.DropDownStyle = ComboBoxStyle.DropDownList;
        box.FlatStyle = FlatStyle.Flat;
        box.BackColor = Input;
        box.ForeColor = TextPrimary;
        box.Items.AddRange(items);
    }

    private static void ConfigureTextBox(TextBox box, string placeholder)
    {
        box.BorderStyle = BorderStyle.FixedSingle;
        box.BackColor = Input;
        box.ForeColor = TextPrimary;
        box.PlaceholderText = placeholder;
    }

    private static void ConfigureNumber(NumericUpDown box, decimal minimum, decimal maximum, decimal value, decimal increment = 1)
    {
        box.Minimum = minimum;
        box.Maximum = maximum;
        box.Value = value;
        box.Increment = increment;
        box.BorderStyle = BorderStyle.FixedSingle;
        box.BackColor = Input;
        box.ForeColor = TextPrimary;
    }

    private static void ConfigureStatus(Label label, string text, float size, Color color)
    {
        label.Text = text;
        label.Font = new Font("Segoe UI Semibold", size);
        label.ForeColor = color;
        label.AutoEllipsis = true;
    }

    private static void StyleButton(Button button, string text, Color color)
    {
        button.Text = text;
        button.Dock = DockStyle.Fill;
        button.Margin = new Padding(4);
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.BackColor = color;
        button.ForeColor = TextPrimary;
        button.Font = new Font("Segoe UI Semibold", 9F);
        button.Cursor = Cursors.Hand;
    }

    private async Task OpenClientAsync()
    {
        if (busy) return;
        SetBusy(true);
        operationCancellation = new CancellationTokenSource();
        try
        {
            var process = await runtime.EnsureGameAsync(operationCancellation.Token);
            connectionLabel.Text = $"Official client detected • PID {process.Id}";
            connectionLabel.ForeColor = Success;
        }
        catch (OperationCanceledException) { }
        catch (Exception error)
        {
            connectionLabel.Text = "Official client is not ready";
            connectionLabel.ForeColor = Accent;
            AppendLog("ERROR  " + error.Message);
            MessageBox.Show(error.Message, "PokeBridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            operationCancellation.Dispose();
            operationCancellation = null;
            SetBusy(false);
        }
    }

    private async Task StartAutomationAsync()
    {
        if (busy || runtime.IsRunning) return;
        SetBusy(true);
        operationCancellation = new CancellationTokenSource();
        try
        {
            var options = new StartOptions(
                SelectedMode(), targetBox.Text,
                Decimal.ToInt32(levelMinBox.Value), Decimal.ToInt32(levelMaxBox.Value),
                trainingSlotBox.SelectedIndex, Decimal.ToInt32(paceBox.Value), shinyBox.Checked);
            await runtime.StartAsync(options, operationCancellation.Token);
            if (runtime.GameProcess is not null)
            {
                connectionLabel.Text = $"Official client connected • PID {runtime.GameProcess.Id}";
                connectionLabel.ForeColor = Success;
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error)
        {
            AppendLog("ERROR  " + error.Message);
            MessageBox.Show(error.Message, "PokeBridge could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            operationCancellation.Dispose();
            operationCancellation = null;
            SetBusy(false);
        }
    }

    private void SetBusy(bool value)
    {
        busy = value;
        UseWaitCursor = value;
        clientButton.Enabled = !value && !runtime.IsRunning;
        startButton.Enabled = !value && !runtime.IsRunning;
        stopButton.Enabled = runtime.IsRunning;
    }

    private void SetRunning(bool running)
    {
        clientButton.Enabled = !running && !busy;
        startButton.Enabled = !running && !busy;
        stopButton.Enabled = running;
        activityLabel.Text = running ? "Running" : "Idle";
        activityLabel.ForeColor = running ? Success : TextMuted;
    }

    private void UpdateModeFields()
    {
        targetBox.Enabled = SelectedMode() == "hunt";
        trainingSlotBox.Enabled = SelectedMode() is "train" or "badges";
        levelMinBox.Enabled = SelectedMode() is "train" or "hunt";
        levelMaxBox.Enabled = SelectedMode() is "train" or "hunt";
    }

    private string SelectedMode() => modeBox.SelectedIndex switch
    {
        1 => "hunt",
        2 => "shiny",
        3 => "explore",
        4 => "badges",
        _ => "train",
    };

    private void RefreshStatus()
    {
        if (!File.Exists(runtime.StatusPath)) return;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(runtime.StatusPath));
            var root = document.RootElement;
            var running = root.TryGetProperty("running", out var runningNode) && runningNode.GetBoolean();
            var phase = JsonText(root, "phase")?.Replace('_', ' ') ?? (running ? "Running" : "Idle");
            activityLabel.Text = Capitalize(phase);
            activityLabel.ForeColor = running ? Success : TextMuted;

            if (root.TryGetProperty("world", out var world))
            {
                var name = JsonText(world, "name") ?? JsonText(world, "map") ?? "Unknown map";
                locationLabel.Text = $"{name}   •   ({Number(world, "x")}, {Number(world, "y")})";
            }
            if (root.TryGetProperty("enemy", out var enemy) && enemy.ValueKind == JsonValueKind.Object)
            {
                var species = JsonText(enemy, "species") ?? "Unknown Pokémon";
                var level = Number(enemy, "level");
                var hp = Number(enemy, "hp");
                var shiny = Boolean(enemy, "shiny") || Boolean(enemy, "secretShiny") ? " • SHINY" : string.Empty;
                battleLabel.Text = $"{species}   Lv. {level}   HP {hp}{shiny}";
            }
            else if (root.TryGetProperty("campaign", out var campaign) && campaign.ValueKind == JsonValueKind.Object
                && campaign.TryGetProperty("currentGym", out var gym) && gym.ValueKind == JsonValueKind.Object)
            {
                var leader = JsonText(gym, "leader") ?? "Next leader";
                var badge = JsonText(gym, "badge") ?? "next badge";
                var city = JsonText(gym, "city") ?? "Kanto";
                battleLabel.Text = $"Next: {leader}   •   {badge}\r\n{city}   •   Target Lv. {Number(gym, "trainingTarget")}";
            }
            else battleLabel.Text = "No active battle";

            if (root.TryGetProperty("totals", out var totals))
            {
                totalsLabel.Text = $"Maps {Number(totals, "maps")}   •   Steps {Number(totals, "steps")}   •   Battles {Number(totals, "battles")}\r\nCenters {Number(totals, "pokemonCenters")}   •   Grass tiles {Number(root, "confirmedEncounterTerrainTiles")}   •   Species {Number(totals, "speciesIndexed")}";
            }
            var error = JsonText(root, "lastError");
            if (!string.IsNullOrWhiteSpace(error) && !logBox.Text.EndsWith(error + Environment.NewLine, StringComparison.Ordinal))
                AppendLog("ERROR  " + error);
        }
        catch (IOException) { }
        catch (JsonException) { }
    }

    private void AppendLog(string message)
    {
        logBox.AppendText(message + Environment.NewLine);
        logBox.SelectionStart = logBox.TextLength;
        logBox.ScrollToCaret();
    }

    private void Ui(Action action)
    {
        if (IsDisposed) return;
        if (InvokeRequired) BeginInvoke(action);
        else action();
    }

    private static string? JsonText(JsonElement parent, string property) =>
        parent.TryGetProperty(property, out var node) && node.ValueKind == JsonValueKind.String ? node.GetString() : null;
    private static long Number(JsonElement parent, string property) =>
        parent.TryGetProperty(property, out var node) && node.TryGetInt64(out var value) ? value : 0;
    private static bool Boolean(JsonElement parent, string property) =>
        parent.TryGetProperty(property, out var node) && node.ValueKind is JsonValueKind.True;
    private static string Capitalize(string value) => value.Length == 0 ? value : char.ToUpperInvariant(value[0]) + value[1..];
}
