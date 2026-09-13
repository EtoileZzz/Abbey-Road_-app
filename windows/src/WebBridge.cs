using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Media;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace AbbeyRoad
{
    /// <summary>
    /// 网页 ↔ 原生 的桥。协议与 android/MainActivity.java 完全一致：
    ///   网页 → {id, method, args}     原生 → {replyTo, result} 或 {event, ...}
    /// </summary>
    internal class WebBridge
    {
        private readonly MainForm _form;
        private readonly CoreWebView2 _core;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        public WebBridge(MainForm form, CoreWebView2 core)
        {
            _form = form;
            _core = core;
        }

        public void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw = null;
            try { raw = e.TryGetWebMessageAsString(); }
            catch (Exception) { }
            if (string.IsNullOrEmpty(raw)) { return; }

            Dictionary<string, object> msg;
            try { msg = _json.Deserialize<Dictionary<string, object>>(raw); }
            catch (Exception) { return; }
            if (msg == null || !msg.ContainsKey("method")) { return; }

            string id = msg.ContainsKey("id") ? Convert.ToString(msg["id"]) : null;
            string method = Convert.ToString(msg["method"]);
            object[] args = (msg.ContainsKey("args") && msg["args"] is object[]) ? (object[])msg["args"] : new object[0];

            try
            {
                object result = Dispatch(method, args);
                Reply(id, result);
            }
            catch (Exception ex)
            {
                Reply(id, "error: " + ex.Message);
            }
        }

        private object Dispatch(string method, object[] a)
        {
            switch ((method ?? "").ToLowerInvariant())
            {
                case "platform": return "windows";
                case "sdkint": return 0;
                case "devicename": return Environment.MachineName;
                case "appversion": return AppPaths.Version;
                case "vibrate": return null;                       // Windows 无震动，视觉脉冲由网页负责
                case "beep": return Beep(Str(a, 0));
                case "copy": Clipboard.SetText(Str(a, 0)); return "ok";
                case "toast": return null;                          // toast 由网页自绘
                case "sharetext": Clipboard.SetText(Str(a, 1)); return "copied";
                case "canhandle": return true;
                case "openurl": Shell(Str(a, 0)); return "ok";
                case "openmap": return OpenMap(Str(a, 0), Str(a, 1), Str(a, 2));
                case "setalarm": return SetAlarm(a);
                case "addcalendarevent": return AddCalendarEvent(a);
                case "exporttext": return ExportText(Str(a, 0), Str(a, 1), Str(a, 2));
                case "importtext": return ImportText();
                case "setsystembars": SetBars(Str(a, 0), Bool(a, 1)); return "ok";
                case "setbackdrop": _form.SetBackdropEnabled(Bool(a, 0)); return "ok";
                case "exitapp": BeginInvoke(delegate { Application.Exit(); }); return "ok";
                default: return null;
            }
        }

        /// <summary>Windows 端只有"警告音"这一种声音反馈，避免每次点击都响。</summary>
        private string Beep(string kind)
        {
            if (kind == "warn")
            {
                try { SystemSounds.Exclamation.Play(); } catch (Exception) { }
            }
            return "ok";
        }

        private string OpenMap(string pref, string keyword, string webFallback)
        {
            string url = webFallback;
            if (string.IsNullOrEmpty(url))
            {
                string q = Uri.EscapeDataString(keyword ?? "");
                if (pref == "baidu") { url = "https://map.baidu.com/search/" + q; }
                else if (pref == "google") { url = "https://maps.google.com/?q=" + q; }
                else { url = "https://uri.amap.com/search?keyword=" + q; }
            }
            Shell(url);
            return url;
        }

        /// <summary>
        /// Windows 没有可写入的系统闹钟接口：按规划文档降级为「复制时间 + 提示」，
        /// 同时给出「添加到日历」的等价路径（导出 .ics 并打开）。
        /// </summary>
        private string SetAlarm(object[] a)
        {
            int hh = Int(a, 0);
            int mm = Int(a, 1);
            string msg = Str(a, 2);
            string text = (hh < 10 ? "0" + hh : "" + hh) + ":" + (mm < 10 ? "0" + mm : "" + mm);
            if (!string.IsNullOrEmpty(msg)) { text = text + " " + msg; }
            try { Clipboard.SetText(text); } catch (Exception) { }
            return "Windows 没有系统闹钟接口，已复制「" + text + "」，可粘贴到「闹钟和时钟」应用里新建。";
        }

        private string AddCalendarEvent(object[] a)
        {
            string title = Str(a, 0);
            string location = Str(a, 1);
            string desc = Str(a, 2);
            long begin = Long(a, 3);
            long end = Long(a, 4);
            if (begin <= 0) { return "时间无效"; }
            if (end <= begin) { end = begin + 45 * 60 * 1000; }

            DateTimeOffset s = DateTimeOffset.FromUnixTimeMilliseconds(begin).ToLocalTime();
            DateTimeOffset e = DateTimeOffset.FromUnixTimeMilliseconds(end).ToLocalTime();
            StringBuilder sb = new StringBuilder();
            sb.Append("BEGIN:VCALENDAR\r\n");
            sb.Append("VERSION:2.0\r\n");
            sb.Append("PRODID:-//Abbey Road//Schedule//CN\r\n");
            sb.Append("CALSCALE:GREGORIAN\r\n");
            sb.Append("BEGIN:VEVENT\r\n");
            sb.Append("UID:").Append(Guid.NewGuid().ToString("N")).Append("@abbeyroad\r\n");
            sb.Append("DTSTAMP:").Append(DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'")).Append("\r\n");
            sb.Append("DTSTART:").Append(s.ToString("yyyyMMdd'T'HHmmss")).Append("\r\n");
            sb.Append("DTEND:").Append(e.ToString("yyyyMMdd'T'HHmmss")).Append("\r\n");
            sb.Append("SUMMARY:").Append(Ics(title)).Append("\r\n");
            sb.Append("LOCATION:").Append(Ics(location)).Append("\r\n");
            sb.Append("DESCRIPTION:").Append(Ics(desc)).Append("\r\n");
            sb.Append("BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\nDESCRIPTION:")
              .Append(Ics(title)).Append("\r\nEND:VALARM\r\n");
            sb.Append("END:VEVENT\r\nEND:VCALENDAR\r\n");

            string path = Path.Combine(Path.GetTempPath(),
                "AbbeyRoad-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".ics");
            File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            Shell(path);
            return "ics";
        }

        private string ExportText(string fileName, string content, string mime)
        {
            using (SaveFileDialog dlg = new SaveFileDialog())
            {
                dlg.Title = "导出 Abbey Road 数据";
                dlg.FileName = string.IsNullOrEmpty(fileName) ? "AbbeyRoad-backup.json" : fileName;
                dlg.Filter = (mime != null && mime.IndexOf("json", StringComparison.OrdinalIgnoreCase) >= 0)
                    ? "JSON 配置 (*.json)|*.json|所有文件 (*.*)|*.*"
                    : "文本文件 (*.md;*.txt)|*.md;*.txt|所有文件 (*.*)|*.*";
                if (dlg.ShowDialog(_form) != DialogResult.OK) { return "cancelled"; }
                File.WriteAllText(dlg.FileName, content, new UTF8Encoding(false));
                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["event"] = "exported";
                payload["name"] = Path.GetFileName(dlg.FileName);
                Post(payload);
                return dlg.FileName;
            }
        }

        private string ImportText()
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "导入 Abbey Road 数据";
                dlg.Filter = "课表与配置 (*.json;*.md;*.txt)|*.json;*.md;*.txt|所有文件 (*.*)|*.*";
                if (dlg.ShowDialog(_form) != DialogResult.OK) { return "cancelled"; }
                string text = File.ReadAllText(dlg.FileName, Encoding.UTF8);
                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["event"] = "fileText";
                payload["text"] = text;
                payload["name"] = Path.GetFileName(dlg.FileName);
                Post(payload);
                return dlg.FileName;
            }
        }

        private void SetBars(string hex, bool lightIcons)
        {
            _form.SetDark(!lightIcons);
        }

        public void NotifyResize()
        {
            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["event"] = "resize";
            Post(payload);
        }

        public void NotifyError(string message)
        {
            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["event"] = "error";
            payload["message"] = message;
            Post(payload);
        }

        private void Reply(string id, object result)
        {
            if (string.IsNullOrEmpty(id)) { return; }
            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["replyTo"] = id;
            payload["result"] = result;
            Post(payload);
        }

        private void Post(Dictionary<string, object> payload)
        {
            try { _core.PostWebMessageAsString(_json.Serialize(payload)); }
            catch (Exception) { }
        }

        private void BeginInvoke(Action action)
        {
            try { _form.BeginInvoke(action); } catch (Exception) { }
        }

        private static void Shell(string target)
        {
            if (string.IsNullOrEmpty(target)) { return; }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(target);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception) { }
        }

        private static string Ics(string s)
        {
            if (string.IsNullOrEmpty(s)) { return ""; }
            return s.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,")
                    .Replace("\r\n", "\\n").Replace("\n", "\\n");
        }

        private static string Str(object[] a, int i)
        {
            if (a == null || i >= a.Length || a[i] == null) { return ""; }
            return Convert.ToString(a[i]);
        }

        private static int Int(object[] a, int i)
        {
            int v;
            return int.TryParse(Str(a, i), out v) ? v : 0;
        }

        private static long Long(object[] a, int i)
        {
            long v;
            return long.TryParse(Str(a, i), out v) ? v : 0;
        }

        private static bool Bool(object[] a, int i)
        {
            if (a == null || i >= a.Length || a[i] == null) { return false; }
            if (a[i] is bool) { return (bool)a[i]; }
            bool v;
            return bool.TryParse(Convert.ToString(a[i]), out v) && v;
        }
    }
}
