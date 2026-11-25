using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// This target stays at the same path across per-user upgrades.
internal static class DesktopStart
{
    static readonly string Root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');

    static string ReadVersion(string pointer)
    {
        var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
            File.ReadAllText(Path.Combine(Root, pointer)));
        string value = data["version"] as string;
        if (value == null || !Regex.IsMatch(value, @"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"))
            throw new InvalidDataException("RADAZ versiyası düzgün deyil.");
        return value;
    }

    static string VersionDirectory(string version)
    {
        string versions = Path.Combine(Root, "versions");
        string dir = Path.Combine(versions, version);
        foreach (string path in new[] { versions, dir })
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("RADAZ versiya qovluğu düzgün deyil.");
        return dir;
    }

    static string Quote(string value)
    {
        if (value.IndexOf('"') >= 0)
            throw new ArgumentException("Invalid argument");
        return "\"" + value + new string('\\', value.Length - value.TrimEnd('\\').Length) + "\"";
    }

    static int RunController(string directory, string[] args, StreamWriter log)
    {
        var start = new ProcessStartInfo(Path.Combine(directory, @"runtime\python\python.exe"),
                                         String.Join(" ", Array.ConvertAll(args, Quote)));
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WorkingDirectory = directory;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        using (var child = new Process())
        {
            child.StartInfo = start;
            DataReceivedEventHandler record = delegate(object sender, DataReceivedEventArgs line)
            {
                if (line.Data != null)
                    lock (log) { log.WriteLine(line.Data); }
            };
            child.OutputDataReceived += record;
            child.ErrorDataReceived += record;
            child.Start();
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            child.WaitForExit();
            return child.ExitCode;
        }
    }

    static void UpdateShortcuts(bool existingOnly)
    {
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell", true));
        string executable = Path.Combine(Root, "RADAZ-Start.exe");
        var folders = new[] { Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.Programs,
                              Environment.SpecialFolder.Startup };
        foreach (var folder in folders)
        {
            string dir = Environment.GetFolderPath(folder);
            if (String.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
            string path = Path.Combine(dir, "RADAZ.lnk");
            if (existingOnly && !File.Exists(path)) continue;
            dynamic link = shell.CreateShortcut(path);
            if (existingOnly)
            {
                string previous = (string)link.TargetPath;
                string args = (string)link.Arguments;
                if (!String.Equals(Path.GetFileName(previous), "powershell.exe", StringComparison.OrdinalIgnoreCase))
                    continue;
                if (args.IndexOf("\"" + Path.Combine(Root, "launcher.ps1") + "\"", StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
            }
            link.TargetPath = executable;
            link.Arguments = "";
            link.WorkingDirectory = Root;
            link.IconLocation = Path.Combine(Root, "radaz.ico") + ",0";
            link.Description = "RADAZ DICOM Viewer";
            link.Save();
        }
    }

    static string SelectController(StreamWriter log)
    {
        string active = ReadVersion("active.json");
        string directory = VersionDirectory(active);
        if (File.Exists(Path.Combine(Root, "pending.json")))
        {
            string pending = ReadVersion("pending.json");
            if (new Version(pending) > new Version(active))
            {
                // Run the existing trusted interpreter before launching any candidate code.
                string candidate = VersionDirectory(pending);
                const string verify = "import sys; from pathlib import Path; import radaz_desktop as d; " +
                    "d.validate_directory(d.version_dir(Path(sys.argv[1]),sys.argv[2]),sys.argv[2])";
                if (RunController(directory, new[] { "-c", verify, Root, pending }, log) == 0)
                    return candidate;
                log.WriteLine("Update integrity check failed. Retaining the active controller.");
            }
        }
        return directory;
    }

    [STAThread]
    static int Main(string[] args)
    {
        string mode = args.Length == 0 ? "open" : args[0];
        if (args.Length > 1 || Array.IndexOf(new[] { "open", "--no-browser", "--uninstall", "--shortcuts",
                                                     "--migrate-shortcuts" }, mode) < 0)
            return 64;
        try
        {
            if (mode == "--shortcuts" || mode == "--migrate-shortcuts")
            {
                UpdateShortcuts(mode == "--migrate-shortcuts");
                return 0;
            }
            string logs = Path.Combine(Root, "logs");
            Directory.CreateDirectory(logs);
            string file = Path.Combine(logs, "launcher-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" +
                                              Guid.NewGuid().ToString("N") + ".log");
            using (var log = new StreamWriter(file))
            {
                log.AutoFlush = true;
                string directory = SelectController(log);
                var options = new List<string> { Path.Combine(directory, @"bridge\radaz_desktop.py"),
                    mode == "--uninstall" ? "uninstall" : "launch", "--install-root", Root };
                if (mode == "--no-browser") options.Add("--no-browser");
                if (RunController(directory, options.ToArray(), log) != 0)
                    throw new IOException("RADAZ açıla bilmədi. " + file);
            }
            return 0;
        }
        catch (Exception error)
        {
            if (mode == "open")
                MessageBox.Show(error.Message, "RADAZ", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
