#!/usr/bin/env gjs
// opencode-sudo-popup — modern Adwaita askpass dialog (GJS + GTK4 + libadwaita).
// Contract (identical to shell askpass): prints password to stdout on
// Authenticate, exits 1 on Cancel. Reads context from /tmp/opencode-sudo-reason.
//
// The reason file may be JSON {"command","purpose","ts"} written by the opencode
// plugin, or a legacy flat string (whole content = command, no purpose).

imports.gi.versions.Gtk = "4.0";
imports.gi.versions.Adw = "1";
const { Gtk, Gdk, GLib, Adw } = imports.gi;

const REASON = "/tmp/opencode-sudo-reason";
const TITLE = "Opencode — Administrator access required";

// ---------- read + sanitize context (JSON with flat-string fallback) ---------
function readCommand() {
  let file;
  try {
    file = GLib.file_new_for_path(REASON);
    if (!file.query_exists(null)) return { command: "", device: "" };
    const [, content] = file.load_contents(null);
    return parseContext(new TextDecoder().decode(content));
  } catch {
    return { command: "", device: "" };
  }
}

function parseContext(raw) {
  const s = (raw || "").trim();
  if (s.startsWith("{")) {
    try {
      const d = JSON.parse(s);
      const command = oneLine(d.command || "").slice(0, 300);
      const purpose = oneLine(d.purpose || "");
      return { command, purpose, device: oneLine(d.device || "") };
    } catch {
      // fall through to best-effort values
    }
  }
  // legacy flat string: whole content is the command
  return { command: oneLine(raw || "").slice(0, 300), purpose: "", device: "" };
}

function oneLine(t) {
  return String(t).replace(/\s+/g, " ").trim();
}

const GENERIC_WHY = "Opencode requested root to run the command below. Only approve if you expected a privileged step.";

// ---------- build UI ----------
Adw.init();
Gtk.init();

const { command, purpose, device } = readCommand();
const why = purpose || GENERIC_WHY;

function labelMarkup(text, cssClass) {
  const lbl = new Gtk.Label({ label: text, wrap: true, xalign: 0 });
  lbl.add_css_class(cssClass);
  return lbl;
}

const app = new Gtk.Application();
let finished = false;

app.connect("activate", () => {
  // main window (dialog-like)
  const win = new Adw.Window({
    application: app,
    title: TITLE,
    modal: true,
    resizable: false,
    default_width: 460,
  });
  win.set_icon_name("dialog-password");
  win.add_css_class("csd");
  win.add_css_class("devel");
  win.add_css_class("background");

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24 });
  win.set_content(content);

  // header
  const headerBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 16 });
  content.append(headerBox);

  const icon = new Gtk.Image({ icon_name: "dialog-password", pixel_size: 48 });
  headerBox.append(icon);

  const headText = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, valign: Gtk.Align.CENTER });
  const titleLbl = labelMarkup("Opencode wants administrative access", "title-1");
  titleLbl.wrap = false;
  headText.append(titleLbl);
  const subLbl = labelMarkup("Grant root permission to run a single command", "dim-label");
  headText.append(subLbl);
  headerBox.append(headText);

  // separator
  content.append(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, margin_top: 16, margin_bottom: 16 }));

  // Why section
  const whyTitle = labelMarkup("Why this is needed", "heading");
  content.append(whyTitle);
  content.append(labelMarkup(escapeMarkup(why), "body"));
  const whyDivider = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, margin_top: 12, margin_bottom: 12 });
  content.append(whyDivider);

  // Command section
  const cmdTitle = labelMarkup("Command that will run", "heading");
  content.append(cmdTitle);

  const cmdFrame = new Gtk.Frame();
  cmdFrame.add_css_class("view");
  cmdFrame.set_margin_top(4);
  const cmdBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_top: 10, margin_bottom: 10, margin_start: 12, margin_end: 12 });
  const cmdLabel = labelMarkup(escapeMarkup(command), "monospace");
  cmdBox.append(cmdLabel);
  if (device) {
    cmdBox.append(labelMarkup(escapeMarkup(`in ${device}`), "dim-label"));
  }
  cmdFrame.set_child(cmdBox);
  content.append(cmdFrame);

  // warning + password row
  const warn = labelMarkup("⚠ This grants full root access for this command only. Cancel if this looks unexpected.", "dim-label");
  warn.set_margin_top(16);
  content.append(warn);

  const pwRow = new Adw.PasswordEntryRow();
  pwRow.set_title("Password");
  pwRow.set_activates_default(true);
  pwRow.set_margin_top(8);
  pwRow.set_margin_bottom(16);
  content.append(pwRow);

  const finish = (pw) => {
    if (finished) return;
    finished = true;
    if (pw) print(pw);
    win.close();
  };

  // action buttons
  const actionBar = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, halign: Gtk.Align.END });
  content.append(actionBar);

  const cancelBtn = new Gtk.Button({ label: "Cancel" });
  cancelBtn.connect("clicked", () => finish(""));
  actionBar.append(cancelBtn);

  const okBtn = new Gtk.Button({ label: "Authenticate" });
  okBtn.add_css_class("suggested-action");
  okBtn.connect("clicked", () => finish(pwRow.get_text()));
  actionBar.append(okBtn);
  win.set_default_widget(okBtn);

  pwRow.connect("activate", () => finish(pwRow.get_text()));

  win.present();
});

app.run(null);
if (!finished) process.exit(1); // window closed without authenticating
process.exit(0);

// ---------- helpers ----------
function escapeMarkup(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
