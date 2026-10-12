using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class MusicSuiteLauncher
{
    internal static string DataDirectory;
    internal static string Url;
    internal static string LogFile;
    internal static bool Headless;
    private static readonly object LogLock = new object();

    [STAThread]
    private static int Main(string[] args)
    {
        Headless = Array.IndexOf(args, "--headless") >= 0;
        try
        {
            DataDirectory = Path.GetFullPath(Environment.GetEnvironmentVariable("MUSICSUITE_DATA_DIR")
                ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MusicSuite", "Library"));
            Directory.CreateDirectory(DataDirectory);
            LogFile = Path.Combine(DataDirectory, "launcher.log");
            int port;
            if (!int.TryParse(Environment.GetEnvironmentVariable("PORT") ?? "3333", out port) || port < 1 || port > 65535)
                throw new Exception("Choose a port between 1 and 65535.");
            Url = "http://127.0.0.1:" + port;
            string key;
            using (SHA256 hash = SHA256.Create())
                key = "Local\\MusicSuite-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(DataDirectory.ToUpperInvariant() + "|" + port))).Replace("-", "");

            if (Array.IndexOf(args, "--quit") >= 0)
            {
                using (EventWaitHandle signal = EventWaitHandle.OpenExisting(key + "-quit")) signal.Set();
                return 0;
            }

            bool created;
            using (Mutex instance = new Mutex(true, key, out created))
            {
                if (!created)
                {
                    for (int attempt = 0; attempt < 60 && !IsReady(); attempt++) Thread.Sleep(250);
                    if (!IsReady()) throw new Exception("MusicSuite is still starting. Try opening it again in a moment.");
                    OpenBrowser();
                    return 0;
                }
                try
                {

                    TcpListener reservation = new TcpListener(IPAddress.Loopback, port);
                    try { reservation.Start(); }
                    catch (SocketException) { throw new Exception("Another app is using port " + port + ". Close that app, then open MusicSuite again."); }
                    finally { reservation.Stop(); }

                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    using (PortableContext context = new PortableContext(key, port)) Application.Run(context);
                    return Environment.ExitCode;
                }
                finally { instance.ReleaseMutex(); }
            }
        }
        catch (Exception error) { ShowError(error.Message); return 1; }
    }

    internal static void Log(string message)
    {
        if (LogFile == null || string.IsNullOrWhiteSpace(message)) return;
        lock (LogLock)
        {
            try { File.AppendAllText(LogFile, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine); }
            catch { /* Do not make an unwritable log prevent shutdown. */ }
        }
    }

    internal static void ShowError(string message)
    {
        Log(message);
        Environment.ExitCode = 1;
        if (!Headless) MessageBox.Show(message + "\n\nIf it keeps happening, check launcher.log in your MusicSuite library folder.",
            "MusicSuite could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    internal static bool IsReady()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Url + "/api/health");
            request.Proxy = null; request.Timeout = 500; request.ReadWriteTimeout = 500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                string body = reader.ReadToEnd();
                return response.StatusCode == HttpStatusCode.OK && body.Contains("\"app\":\"MusicSuite\"") && body.Contains("\"status\":\"ok\"");
            }
        }
        catch { return false; }
    }

    internal static void OpenBrowser()
    {
        if (Headless || Environment.GetEnvironmentVariable("MUSICSUITE_NO_BROWSER") == "1") return;
        try { Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }); }
        catch { ShowError("Open " + Url + " in your browser to use MusicSuite."); }
    }
}

internal sealed class PortableContext : ApplicationContext
{
    private readonly Process host;
    private readonly EventWaitHandle quit;
    private readonly System.Windows.Forms.Timer timer;
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu;
    private readonly DateTime started = DateTime.UtcNow;
    private DateTime? closing;
    private bool ready;
    private bool disposed;

    internal PortableContext(string key, int port)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "runtime", "node.exe");
        string tools = Path.Combine(root, "tools");
        string app = Path.Combine(root, "app");
        foreach (string file in new[] { node, Path.Combine(tools, "yt-dlp.exe"), Path.Combine(tools, "ffmpeg.exe"), Path.Combine(tools, "ffprobe.exe"), Path.Combine(app, "dist", "index.html") })
            if (!File.Exists(file)) throw new Exception("MusicSuite is missing a required file. Extract the entire ZIP into a folder, then open MusicSuite.exe there.");

        quit = new EventWaitHandle(false, EventResetMode.AutoReset, key + "-quit");
        ProcessStartInfo launch = new ProcessStartInfo(node, "\"" + Path.Combine(app, "scripts", "desktop-host.mjs") + "\"");
        launch.WorkingDirectory = app;
        launch.UseShellExecute = false; launch.CreateNoWindow = true; launch.WindowStyle = ProcessWindowStyle.Hidden;
        launch.RedirectStandardInput = true; launch.RedirectStandardOutput = true; launch.RedirectStandardError = true;
        launch.EnvironmentVariables["MUSICSUITE_DATA_DIR"] = MusicSuiteLauncher.DataDirectory;
        launch.EnvironmentVariables["MUSICSUITE_PORTABLE"] = "1";
        launch.EnvironmentVariables["MUSICSUITE_YTDLP"] = Path.Combine(tools, "yt-dlp.exe");
        launch.EnvironmentVariables["MUSICSUITE_FFMPEG"] = Path.Combine(tools, "ffmpeg.exe");
        launch.EnvironmentVariables["MUSICSUITE_FFPROBE"] = Path.Combine(tools, "ffprobe.exe");
        launch.EnvironmentVariables["PORT"] = port.ToString();
        host = new Process { StartInfo = launch };
        host.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { MusicSuiteLauncher.Log(e.Data); };
        host.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { MusicSuiteLauncher.Log(e.Data); };
        host.Start(); host.BeginOutputReadLine(); host.BeginErrorReadLine();

        menu = new ContextMenuStrip();
        menu.Items.Add("Open MusicSuite", null, delegate { if (ready) MusicSuiteLauncher.OpenBrowser(); });
        menu.Items.Add("Open library folder", null, delegate { Process.Start(new ProcessStartInfo(MusicSuiteLauncher.DataDirectory) { UseShellExecute = true }); });
        menu.Items.Add("Quit MusicSuite", null, delegate { BeginQuit(); });
        tray = new NotifyIcon { Text = "MusicSuite is starting", Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath), ContextMenuStrip = menu, Visible = !MusicSuiteLauncher.Headless };
        tray.DoubleClick += delegate { if (ready) MusicSuiteLauncher.OpenBrowser(); };
        timer = new System.Windows.Forms.Timer { Interval = 250 };
        timer.Tick += Tick;
        timer.Start();
        Application.ApplicationExit += OnApplicationExit;
    }

    private void Tick(object sender, EventArgs e)
    {
        if (quit.WaitOne(0)) BeginQuit();
        if (host.HasExited)
        {
            if (!closing.HasValue) MusicSuiteLauncher.ShowError("MusicSuite's local server stopped. Try opening the app again.");
            ExitThread(); return;
        }
        if (closing.HasValue)
        {
            if ((DateTime.UtcNow - closing.Value).TotalSeconds > 15)
            {
                MusicSuiteLauncher.Log("Server shutdown timed out; closing the owned process tree.");
                using (Process killer = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + host.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true })) killer.WaitForExit(5000);
                ExitThread();
            }
            return;
        }
        if (!ready && MusicSuiteLauncher.IsReady())
        {
            ready = true; tray.Text = "MusicSuite"; MusicSuiteLauncher.OpenBrowser();
        }
        else if (!ready && (DateTime.UtcNow - started).TotalSeconds > 45)
        {
            MusicSuiteLauncher.ShowError("MusicSuite took too long to start. Try extracting it into a new folder and opening it again.");
            BeginQuit();
        }
    }

    private void BeginQuit()
    {
        if (closing.HasValue) return;
        closing = DateTime.UtcNow; tray.Text = "MusicSuite is closing";
        try { host.StandardInput.WriteLine("quit"); host.StandardInput.Flush(); }
        catch { /* A crashed host is detected by the timer. */ }
    }

    private void OnApplicationExit(object sender, EventArgs e)
    {

        try { host.StandardInput.Close(); } catch { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed)
        {
            disposed = true;
            Application.ApplicationExit -= OnApplicationExit;
            timer.Stop(); timer.Dispose(); tray.Visible = false;
            Icon icon = tray.Icon;
            tray.Dispose(); if (icon != null) icon.Dispose(); menu.Dispose();
            try { host.StandardInput.Close(); } catch { }
            host.Dispose(); quit.Dispose();
        }
        base.Dispose(disposing);
    }
}
