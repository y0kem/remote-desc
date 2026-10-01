using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PCRemote.Native
{
    internal static class InputBridge
    {
        #region Win32 Constants & Structs

        private const int INPUT_MOUSE = 0;
        private const int INPUT_KEYBOARD = 1;

        private const uint MOUSEEVENTF_MOVE = 0x0001;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_HWHEEL = 0x1000;

        private const uint KEYEVENTF_KEYDOWN = 0x0000;
        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;

        private const uint SPI_SETCURSORS = 0x0057;
        private const uint OCR_NORMAL = 32512;
        private const uint OCR_IBEAM = 32513;
        private const uint OCR_HAND = 32649;

        // Virtual Key Codes
        private const ushort VK_BACK = 0x08;
        private const ushort VK_TAB = 0x09;
        private const ushort VK_RETURN = 0x0D;
        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_MENU = 0x12; // Alt
        private const ushort VK_ESCAPE = 0x1B;
        private const ushort VK_SPACE = 0x20;
        private const ushort VK_LEFT = 0x25;
        private const ushort VK_UP = 0x26;
        private const ushort VK_RIGHT = 0x27;
        private const ushort VK_DOWN = 0x28;
        private const ushort VK_LWIN = 0x5B;
        private const ushort VK_VOLUME_MUTE = 0xAD;
        private const ushort VK_VOLUME_DOWN = 0xAE;
        private const ushort VK_VOLUME_UP = 0xAF;
        private const ushort VK_MEDIA_PLAY_PAUSE = 0xB3;

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct INPUTDATA
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;

            [FieldOffset(0)]
            public KEYBDINPUT ki;

            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public int type;
            public INPUTDATA data;
        }

        #endregion

        #region P/Invoke APIs

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr LoadCursorFromFile(string lpFileName);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetSystemCursor(IntPtr hcur, uint id);

        #endregion

        private static bool _cursorScaled = false;

        private static void Main(string[] args)
        {
            Console.InputEncoding = Encoding.UTF8;
            Console.OutputEncoding = Encoding.UTF8;

            AppDomain.CurrentDomain.ProcessExit += (s, e) => RestoreCursor();
            Console.CancelKeyPress += (s, e) => RestoreCursor();

            Console.WriteLine("READY");
            Console.Out.Flush();

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line))
                    continue;

                if (line.Equals("EXIT", StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }

                try
                {
                    ProcessCommand(line);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("ERR: " + ex.Message);
                    Console.Error.Flush();
                }
            }

            RestoreCursor();
        }

        private static void ProcessCommand(string line)
        {
            int spaceIdx = line.IndexOf(' ');
            string cmd = spaceIdx > 0 ? line.Substring(0, spaceIdx).ToUpperInvariant() : line.ToUpperInvariant();
            string args = spaceIdx > 0 ? line.Substring(spaceIdx + 1).Trim() : string.Empty;

            switch (cmd)
            {
                case "MOVE":
                    HandleMove(args);
                    break;
                case "CLICK":
                    HandleClick(args);
                    break;
                case "MOUSEDOWN":
                    HandleMouseDown(args);
                    break;
                case "MOUSEUP":
                    HandleMouseUp(args);
                    break;
                case "SCROLL":
                    HandleScroll(args);
                    break;
                case "TYPE":
                    HandleType(args);
                    break;
                case "KEY":
                    HandleKey(args);
                    break;
                case "CTRLC":
                    SendCombo(VK_CONTROL, 0x43); // 'C'
                    break;
                case "CTRLV":
                    SendCombo(VK_CONTROL, 0x56); // 'V'
                    break;
                case "CTRLZ":
                    SendCombo(VK_CONTROL, 0x5A); // 'Z'
                    break;
                case "CTRLA":
                    SendCombo(VK_CONTROL, 0x41); // 'A'
                    break;
                case "ALTTAB":
                    SendCombo(VK_MENU, VK_TAB);
                    break;
                case "WIND":
                    SendCombo(VK_LWIN, 0x44); // 'D'
                    break;
                case "CURSOR_SCALE":
                    HandleCursorScale(args);
                    break;
                case "MAGNIFIER":
                    HandleMagnifier(args);
                    break;
                case "PING":
                    Console.WriteLine("PONG");
                    Console.Out.Flush();
                    break;
                default:
                    Console.Error.WriteLine("UNKNOWN_CMD: " + cmd);
                    Console.Error.Flush();
                    break;
            }
        }

        private static void HandleMove(string args)
        {
            var parts = args.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) return;

            int dx, dy;
            if (int.TryParse(parts[0], out dx) && int.TryParse(parts[1], out dy))
            {
                SendMouseInput(dx, dy, 0, MOUSEEVENTF_MOVE);
            }
        }

        private static void HandleClick(string button)
        {
            button = button.ToLowerInvariant();
            if (button == "left")
            {
                SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTDOWN);
                SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTUP);
            }
            else if (button == "right")
            {
                SendMouseInput(0, 0, 0, MOUSEEVENTF_RIGHTDOWN);
                SendMouseInput(0, 0, 0, MOUSEEVENTF_RIGHTUP);
            }
            else if (button == "middle")
            {
                SendMouseInput(0, 0, 0, MOUSEEVENTF_MIDDLEDOWN);
                SendMouseInput(0, 0, 0, MOUSEEVENTF_MIDDLEUP);
            }
            else if (button == "double")
            {
                SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTDOWN);
                SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTUP);
                Thread.Sleep(25);
                SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTDOWN);
                SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTUP);
            }
        }

        private static void HandleMouseDown(string button)
        {
            button = button.ToLowerInvariant();
            if (button == "left") SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTDOWN);
            else if (button == "right") SendMouseInput(0, 0, 0, MOUSEEVENTF_RIGHTDOWN);
            else if (button == "middle") SendMouseInput(0, 0, 0, MOUSEEVENTF_MIDDLEDOWN);
        }

        private static void HandleMouseUp(string button)
        {
            button = button.ToLowerInvariant();
            if (button == "left") SendMouseInput(0, 0, 0, MOUSEEVENTF_LEFTUP);
            else if (button == "right") SendMouseInput(0, 0, 0, MOUSEEVENTF_RIGHTUP);
            else if (button == "middle") SendMouseInput(0, 0, 0, MOUSEEVENTF_MIDDLEUP);
        }

        private static void HandleScroll(string args)
        {
            var parts = args.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return;

            int dy = 0, dx = 0;
            if (int.TryParse(parts[0], out dy))
            {
                SendMouseInput(0, 0, (uint)dy, MOUSEEVENTF_WHEEL);
            }
            if (parts.Length > 1 && int.TryParse(parts[1], out dx) && dx != 0)
            {
                SendMouseInput(0, 0, (uint)dx, MOUSEEVENTF_HWHEEL);
            }
        }

        private static void HandleType(string text)
        {
            if (string.IsNullOrEmpty(text)) return;

            INPUT[] inputs = new INPUT[text.Length * 2];
            int idx = 0;

            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                // Down
                inputs[idx].type = INPUT_KEYBOARD;
                inputs[idx].data.ki.wVk = 0;
                inputs[idx].data.ki.wScan = c;
                inputs[idx].data.ki.dwFlags = KEYEVENTF_UNICODE;
                inputs[idx].data.ki.time = 0;
                inputs[idx].data.ki.dwExtraInfo = IntPtr.Zero;
                idx++;

                // Up
                inputs[idx].type = INPUT_KEYBOARD;
                inputs[idx].data.ki.wVk = 0;
                inputs[idx].data.ki.wScan = c;
                inputs[idx].data.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                inputs[idx].data.ki.time = 0;
                inputs[idx].data.ki.dwExtraInfo = IntPtr.Zero;
                idx++;
            }

            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void HandleKey(string keyName)
        {
            keyName = keyName.ToUpperInvariant();
            switch (keyName)
            {
                case "ENTER":
                case "RETURN":
                    TapVk(VK_RETURN);
                    break;
                case "BACKSPACE":
                case "BACK":
                    TapVk(VK_BACK);
                    break;
                case "TAB":
                    TapVk(VK_TAB);
                    break;
                case "ESC":
                case "ESCAPE":
                    TapVk(VK_ESCAPE);
                    break;
                case "SPACE":
                    TapVk(VK_SPACE);
                    break;
                case "UP":
                    TapVk(VK_UP, true);
                    break;
                case "DOWN":
                    TapVk(VK_DOWN, true);
                    break;
                case "LEFT":
                    TapVk(VK_LEFT, true);
                    break;
                case "RIGHT":
                    TapVk(VK_RIGHT, true);
                    break;
                case "WIN":
                case "START":
                    TapVk(VK_LWIN, true);
                    break;
                case "VOLUP":
                case "VOLUMEUP":
                    TapVk(VK_VOLUME_UP, true);
                    break;
                case "VOLDOWN":
                case "VOLUMEDOWN":
                    TapVk(VK_VOLUME_DOWN, true);
                    break;
                case "MUTE":
                    TapVk(VK_VOLUME_MUTE, true);
                    break;
                case "PLAYPAUSE":
                    TapVk(VK_MEDIA_PLAY_PAUSE, true);
                    break;
                // Combos handled via KEY as well
                case "CTRLC":
                    SendCombo(VK_CONTROL, 0x43);
                    break;
                case "CTRLV":
                    SendCombo(VK_CONTROL, 0x56);
                    break;
                case "CTRLZ":
                    SendCombo(VK_CONTROL, 0x5A);
                    break;
                case "CTRLA":
                    SendCombo(VK_CONTROL, 0x41);
                    break;
                case "ALTTAB":
                    SendCombo(VK_MENU, VK_TAB);
                    break;
                case "WIND":
                    SendCombo(VK_LWIN, 0x44);
                    break;
                default:
                    Console.Error.WriteLine("UNKNOWN_KEY: " + keyName);
                    break;
            }
        }

        private static void HandleCursorScale(string scale)
        {
            scale = scale.ToUpperInvariant();
            if (scale == "NORMAL" || scale == "32" || scale == "RESET")
            {
                RestoreCursor();
            }
            else if (scale == "LARGE" || scale == "72")
            {
                SetCustomCursor("aero_arrow_l.cur");
                _cursorScaled = true;
            }
            else if (scale == "XLARGE" || scale == "96")
            {
                SetCustomCursor("aero_arrow_xl.cur");
                _cursorScaled = true;
            }
            else if (scale == "TOGGLE")
            {
                if (_cursorScaled)
                {
                    RestoreCursor();
                }
                else
                {
                    SetCustomCursor("aero_arrow_l.cur");
                    _cursorScaled = true;
                }
            }
        }

        private static void SetCustomCursor(string cursorFileName)
        {
            string winDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string fullPath = Path.Combine(winDir, "Cursors", cursorFileName);

            if (!File.Exists(fullPath))
            {
                // Fallback to alternative names
                string fallback = Path.Combine(winDir, "Cursors", "arrow_l.cur");
                if (File.Exists(fallback)) fullPath = fallback;
                else return;
            }

            IntPtr hCursor = LoadCursorFromFile(fullPath);
            if (hCursor != IntPtr.Zero)
            {
                SetSystemCursor(hCursor, OCR_NORMAL);
            }
        }

        private static void RestoreCursor()
        {
            try
            {
                SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
                _cursorScaled = false;
            }
            catch { }
        }

        private static void HandleMagnifier(string state)
        {
            state = state.ToUpperInvariant();
            if (state == "ON" || state == "START")
            {
                try
                {
                    Process.Start("magnify.exe");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("MAGNIFY_ON_ERR: " + ex.Message);
                }
            }
            else if (state == "OFF" || state == "STOP")
            {
                KillMagnifier();
            }
            else if (state == "TOGGLE")
            {
                var procs = Process.GetProcessesByName("magnify");
                if (procs.Length > 0)
                {
                    KillMagnifier();
                }
                else
                {
                    try { Process.Start("magnify.exe"); } catch { }
                }
            }
        }

        private static void KillMagnifier()
        {
            try
            {
                foreach (var p in Process.GetProcessesByName("magnify"))
                {
                    try { p.Kill(); } catch { }
                }
            }
            catch { }
        }

        #region Helper Input Methods

        private static void SendMouseInput(int dx, int dy, uint mouseData, uint flags)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].data.mi.dx = dx;
            inputs[0].data.mi.dy = dy;
            inputs[0].data.mi.mouseData = mouseData;
            inputs[0].data.mi.dwFlags = flags;
            inputs[0].data.mi.time = 0;
            inputs[0].data.mi.dwExtraInfo = IntPtr.Zero;

            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void TapVk(ushort vk, bool extended = false)
        {
            INPUT[] inputs = new INPUT[2];
            uint extFlag = extended ? KEYEVENTF_EXTENDEDKEY : 0;

            // Down
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].data.ki.wVk = vk;
            inputs[0].data.ki.wScan = 0;
            inputs[0].data.ki.dwFlags = KEYEVENTF_KEYDOWN | extFlag;
            inputs[0].data.ki.time = 0;
            inputs[0].data.ki.dwExtraInfo = IntPtr.Zero;

            // Up
            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].data.ki.wVk = vk;
            inputs[1].data.ki.wScan = 0;
            inputs[1].data.ki.dwFlags = KEYEVENTF_KEYUP | extFlag;
            inputs[1].data.ki.time = 0;
            inputs[1].data.ki.dwExtraInfo = IntPtr.Zero;

            SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendCombo(ushort modVk, ushort keyVk)
        {
            INPUT[] inputs = new INPUT[4];

            // Modifier down
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].data.ki.wVk = modVk;
            inputs[0].data.ki.dwFlags = KEYEVENTF_KEYDOWN;

            // Key down
            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].data.ki.wVk = keyVk;
            inputs[1].data.ki.dwFlags = KEYEVENTF_KEYDOWN;

            // Key up
            inputs[2].type = INPUT_KEYBOARD;
            inputs[2].data.ki.wVk = keyVk;
            inputs[2].data.ki.dwFlags = KEYEVENTF_KEYUP;

            // Modifier up
            inputs[3].type = INPUT_KEYBOARD;
            inputs[3].data.ki.wVk = modVk;
            inputs[3].data.ki.dwFlags = KEYEVENTF_KEYUP;

            SendInput(4, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        #endregion
    }
}
