using System;
using System.Diagnostics;
using System.IO;

namespace PCRemote.Launcher
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string electronCmd = Path.Combine(baseDir, "node_modules", ".bin", "electron.cmd");
                string nodeCmd = Path.Combine(baseDir, "node_modules", ".bin", "node.cmd");

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.WorkingDirectory = baseDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                if (File.Exists(electronCmd))
                {
                    psi.FileName = "cmd.exe";
                    psi.Arguments = "/c \"\"" + electronCmd + "\" .\"";
                }
                else
                {
                    // Fallback to node server.js
                    psi.FileName = "cmd.exe";
                    psi.Arguments = "/c node server.js";
                }

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                // In case of error, show a message box without console
                System.Windows.Forms.MessageBox.Show(
                    "Error launching PC Remote Controller: " + ex.Message,
                    "PC Remote Controller",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Error
                );
            }
        }
    }
}
