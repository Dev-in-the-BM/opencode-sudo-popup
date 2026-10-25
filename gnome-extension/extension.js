import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SESSION_HELPER = 'list-sessions.py';
const REFRESH_INTERVAL_MS = 30_000;
const MAX_SESSIONS = 100;

export default class OpenCodeSudoApprovalExtension extends Extension {
    enable() {
        this._sessions = [];
        this._activeTab = 'running';
        this._refreshSource = 0;
        this._processCancellable = null;
        this._requestGeneration = 0;
        this._gateService = null;
        this._gateConnection = null;
        this._gateInput = null;
        this._gateEntries = [];
        this._gateFingerprint = '';
        this._gateAllowAfter = 0;

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._indicator.add_child(new St.Icon({
            icon_name: 'system-lock-screen-symbolic',
            style_class: 'system-status-icon',
        }));

        this._buildPanel();
        this._startGateService();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._indicator.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._refreshSessions();
        });

        this._refreshSource = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_MS / 1000,
            () => {
                if (this._indicator?.menu.isOpen)
                    this._refreshSessions();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    disable() {
        if (this._refreshSource) {
            GLib.Source.remove(this._refreshSource);
            this._refreshSource = 0;
        }
        this._processCancellable?.cancel();
        this._processCancellable = null;
        this._gateConnection?.close(null);
        this._gateConnection = null;
        this._gateService?.stop();
        this._gateService?.close();
        this._gateService = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    _buildPanel() {
        const menu = this._indicator.menu;
        const heading = new PopupMenu.PopupMenuItem('OpenCode sessions', {
            reactive: false,
            can_focus: false,
        });
        heading.label.add_style_class_name('heading');
        menu.addMenuItem(heading);

        const approvalHeading = new PopupMenu.PopupMenuItem('Pending approvals', {
            reactive: false,
            can_focus: false,
        });
        approvalHeading.label.add_style_class_name('heading');
        menu.addMenuItem(approvalHeading);

        const approvalItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'opencode-approval-list-item',
        });
        this._approvalList = new St.BoxLayout({
            vertical: true,
            style_class: 'opencode-approval-list',
        });
        approvalItem.add_child(this._approvalList);
        menu.addMenuItem(approvalItem);
        this._renderApprovals();

        const actions = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const actionRow = new St.BoxLayout({ x_expand: true });
        const spacer = new St.Widget({ x_expand: true });
        this._refreshButton = new St.Button({
            label: 'Refresh',
            style_class: 'opencode-session-refresh',
            can_focus: true,
        });
        this._refreshButton.connect('clicked', () => this._refreshSessions());
        actionRow.add_child(spacer);
        actionRow.add_child(this._refreshButton);
        actions.add_child(actionRow);
        menu.addMenuItem(actions);

        const tabs = new St.BoxLayout({
            style_class: 'opencode-session-tabs',
            x_expand: true,
        });
        this._runningTab = this._makeTab('Currently running', 'running');
        this._recentTab = this._makeTab('Recently used', 'recent');
        tabs.add_child(this._runningTab);
        tabs.add_child(this._recentTab);

        const tabItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        tabItem.add_child(tabs);
        menu.addMenuItem(tabItem);

        this._listItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'opencode-session-list-item',
        });
        this._list = new St.BoxLayout({
            vertical: true,
            style_class: 'opencode-session-list',
        });
        this._listItem.add_child(this._list);
        menu.addMenuItem(this._listItem);
        this._renderSessions();
        this._selectTab('running');
    }

    _makeTab(label, name) {
        const button = new St.Button({
            label,
            style_class: 'opencode-session-tab',
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', () => this._selectTab(name));
        return button;
    }

    _startGateService() {
        try {
            const uid = new Gio.Credentials().get_unix_user();
            const display = GLib.getenv('WAYLAND_DISPLAY') ||
                GLib.getenv('DISPLAY') || 'default';
            const safeDisplay = display.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'default';
            const address = Gio.UnixSocketAddress.new_with_type(
                `opencode-sudo-gate-${uid}-${safeDisplay}`,
                Gio.UnixSocketAddressType.ABSTRACT,
            );
            this._gateService = new Gio.SocketService();
            this._gateService.connect('incoming', (_service, connection) => {
                this._acceptGateConnection(connection);
                return true;
            });
            const [listening] = this._gateService.add_address(
                address,
                Gio.SocketType.STREAM,
                Gio.SocketProtocol.DEFAULT,
                null,
            );
            if (!listening)
                throw new Error('could not bind the gate socket');
            this._gateService.start();
        } catch (error) {
            this._gateService?.close();
            this._gateService = null;
            console.error(`${this.metadata.name}: approval bridge unavailable: ${error.message}`);
        }
    }

    _acceptGateConnection(connection) {
        try {
            const credentials = connection.get_socket().get_credentials();
            if (credentials.get_unix_user() !== 0) {
                connection.close(null);
                return;
            }
        } catch (error) {
            connection.close(null);
            console.error(`${this.metadata.name}: could not authenticate gate peer: ${error.message}`);
            return;
        }

        this._gateConnection?.close(null);
        this._gateConnection = connection;
        this._gateInput = new Gio.DataInputStream({
            base_stream: connection.get_input_stream(),
        });
        this._gateInput.set_newline_type(Gio.DataStreamNewlineType.LF);
        this._readGateMessage(connection, this._gateInput);
    }

    _readGateMessage(connection, input) {
        input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
            let line;
            try {
                [line] = stream.read_line_finish_utf8(result);
            } catch (error) {
                this._gateDisconnected(connection, error);
                return;
            }
            if (line === null) {
                this._gateDisconnected(connection);
                return;
            }
            try {
                const message = JSON.parse(line);
                if (message.type === 'update' && Array.isArray(message.entries))
                    this._updateApprovals(message);
            } catch (error) {
                console.error(`${this.metadata.name}: invalid gate message: ${error.message}`);
            }
            if (connection === this._gateConnection)
                this._readGateMessage(connection, input);
        });
    }

    _gateDisconnected(connection, error = null) {
        if (connection !== this._gateConnection)
            return;
        this._gateConnection = null;
        this._gateInput = null;
        this._gateEntries = [];
        this._gateFingerprint = '';
        this._renderApprovals();
        connection.close(null);
        if (error)
            console.debug(`${this.metadata.name}: gate connection ended: ${error.message}`);
    }

    _updateApprovals(message) {
        const entries = message.entries.filter(entry =>
            entry && typeof entry.xid === 'string' &&
            typeof entry.text === 'string');
        const fingerprint = JSON.stringify(entries);
        this._gateAllowAfter = Number(message.allowAfter) || 0;
        if (fingerprint !== this._gateFingerprint) {
            const knownXids = new Set(this._gateEntries.map(entry => entry.xid));
            const hasNewRequest = entries.some(entry => !knownXids.has(entry.xid));
            this._gateFingerprint = fingerprint;
            this._gateEntries = entries;
            this._renderApprovals();
            if (hasNewRequest) {
                Main.notify(this.metadata.name, 'A privileged command is waiting for your approval.');
                this._indicator.menu.open();
            }
        }
    }

    _renderApprovals() {
        if (!this._approvalList)
            return;
        this._approvalList.destroy_all_children();
        if (this._gateEntries.length === 0) {
            this._approvalList.add_child(new St.Label({
                text: this._gateConnection ? 'No pending commands' : 'Approval gate not connected',
                style_class: 'opencode-session-empty',
                x_expand: true,
            }));
            return;
        }

        for (const entry of this._gateEntries)
            this._approvalList.add_child(this._makeApprovalRow(entry));
    }

    _makeApprovalRow(entry) {
        const row = new St.BoxLayout({
            vertical: true,
            style_class: 'opencode-approval-row',
            x_expand: true,
        });
        const command = new St.Label({
            text: entry.text,
            style_class: 'opencode-approval-command',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        command.clutter_text.line_wrap = true;
        command.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        command.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(command);

        if (entry.purpose) {
            const purpose = new St.Label({
                text: entry.purpose,
                style_class: 'opencode-session-directory',
                x_expand: true,
            });
            purpose.clutter_text.line_wrap = true;
            row.add_child(purpose);
        }

        if (entry.cwd) {
            const cwd = new St.Label({
                text: entry.cwd,
                style_class: 'opencode-session-directory',
                x_expand: true,
            });
            cwd.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            row.add_child(cwd);
        }

        const actions = new St.BoxLayout({
            style_class: 'opencode-approval-actions',
            x_expand: true,
        });
        actions.add_child(this._approvalButton('Deny', entry, 'denied', 'once', true));
        actions.add_child(this._approvalButton('Allow once', entry, 'allowed', 'once', false));
        if (entry.session)
            actions.add_child(this._approvalButton('Allow session', entry, 'allowed', 'session', false));
        row.add_child(actions);
        return row;
    }

    _approvalButton(label, entry, status, scope, destructive) {
        const button = new St.Button({
            label,
            style_class: destructive ? 'opencode-approval-deny' : 'opencode-approval-allow',
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });
        button.reactive = GLib.get_monotonic_time() >= this._gateAllowAfter;
        button.connect('clicked', () => this._sendGateDecision(entry, status, scope));
        if (!button.reactive) {
            const remaining = Math.max(1, Math.ceil((this._gateAllowAfter - GLib.get_monotonic_time()) / 1000));
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, remaining, () => {
                button.reactive = true;
                return GLib.SOURCE_REMOVE;
            });
        }
        return button;
    }

    _sendGateDecision(entry, status, scope) {
        if (!this._gateConnection)
            return;
        const message = JSON.stringify({
            type: 'decide',
            decisions: [{ xid: entry.xid, status, scope }],
        });
        try {
            const bytes = new TextEncoder().encode(`${message}\n`);
            const [ok] = this._gateConnection.get_output_stream().write_all(bytes, null);
            if (!ok)
                throw new Error('gate socket write failed');
        } catch (error) {
            this._gateDisconnected(this._gateConnection, error);
        }
    }

    _selectTab(name) {
        this._activeTab = name;
        this._runningTab.remove_style_class_name('selected');
        this._recentTab.remove_style_class_name('selected');
        (name === 'running' ? this._runningTab : this._recentTab)
            .add_style_class_name('selected');
        this._renderSessions();
    }

    _refreshSessions() {
        if (this._processCancellable)
            return;

        const generation = ++this._requestGeneration;
        this._processCancellable = new Gio.Cancellable();
        const helper = this.dir.get_child(SESSION_HELPER);
        const proc = Gio.Subprocess.new([
            '/usr/bin/python3',
            helper.get_path(),
            '--limit', String(MAX_SESSIONS),
        ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

        proc.communicate_utf8_async(null, this._processCancellable, (subprocess, result) => {
            try {
                const [, stdout] = subprocess.communicate_utf8_finish(result);
                if (generation !== this._requestGeneration)
                    return;
                if (!subprocess.get_successful())
                    throw new Error('Session helper returned an error');
                const sessions = JSON.parse(stdout);
                if (!Array.isArray(sessions))
                    throw new Error('Invalid session data');
                this._sessions = sessions;
                this._renderSessions();
            } catch (error) {
                if (error.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED))
                    return;
                this._showMessage('Could not read OpenCode sessions');
                console.error(`${this.metadata.name}: ${error.message}`);
            } finally {
                if (generation === this._requestGeneration) {
                    this._processCancellable = null;
                    this._refreshButton.reactive = true;
                }
            }
        });
        this._refreshButton.reactive = false;
    }

    _renderSessions() {
        if (!this._list)
            return;
        this._list.destroy_all_children();

        const sessions = this._activeTab === 'running'
            ? this._sessions.filter(session => session.running)
            : this._sessions.filter(session => !session.running);

        if (sessions.length === 0) {
            this._showMessage(this._activeTab === 'running'
                ? 'No sessions currently running'
                : 'No recently used sessions');
            return;
        }

        for (const session of sessions.slice(0, 20))
            this._list.add_child(this._makeSessionRow(session));
    }

    _makeSessionRow(session) {
        const row = new St.BoxLayout({
            vertical: true,
            style_class: 'opencode-session-row',
            x_expand: true,
        });
        const title = new St.Label({
            text: session.title || 'Untitled session',
            style_class: 'opencode-session-title',
            x_expand: true,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const directory = new St.Label({
            text: session.directory || '',
            style_class: 'opencode-session-directory',
            x_expand: true,
        });
        directory.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        row.add_child(title);
        row.add_child(directory);
        return row;
    }

    _showMessage(message) {
        this._list.destroy_all_children();
        this._list.add_child(new St.Label({
            text: message,
            style_class: 'opencode-session-empty',
            x_expand: true,
        }));
    }
}
