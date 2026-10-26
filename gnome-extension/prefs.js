import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const GATE_PATH = '/usr/local/bin/opencode-sudo-gate';
const PKEXEC_PATH = '/usr/bin/pkexec';

export default class OpenCodeSudoApprovalPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._rules = [];
        this._busy = false;

        const page = new Adw.PreferencesPage({
            title: 'Permanent rules',
            icon_name: 'security-high-symbolic',
        });
        window.add(page);

        const intro = new Adw.PreferencesGroup({
            title: 'Privileged command rules',
            description: 'Rules match sudo command patterns. Deny rules take precedence over allow rules.',
        });
        page.add(intro);
        this._status = new Adw.ActionRow({ title: 'Loading rules…' });
        intro.add(this._status);

        this._allowGroup = new Adw.PreferencesGroup({ title: 'Always allow' });
        this._denyGroup = new Adw.PreferencesGroup({ title: 'Always deny' });
        page.add(this._allowGroup);
        page.add(this._denyGroup);

        const addGroup = new Adw.PreferencesGroup({
            title: 'Add a rule',
            description: 'Use * and ? as wildcards. Example: sudo apt *',
        });
        page.add(addGroup);
        const addRow = new Adw.ActionRow({ title: 'Command pattern' });
        this._entry = new Gtk.Entry({
            placeholder_text: 'sudo command *',
            hexpand: true,
            width_chars: 28,
            valign: Gtk.Align.CENTER,
        });
        addRow.add_suffix(this._entry);
        const effectModel = Gtk.StringList.new(['Always allow', 'Always deny']);
        this._effect = new Gtk.DropDown({
            model: effectModel,
            valign: Gtk.Align.CENTER,
        });
        addRow.add_suffix(this._effect);
        this._addButton = new Gtk.Button({
            label: 'Add',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        this._addButton.connect('clicked', () => this._addRule());
        addRow.add_suffix(this._addButton);
        addGroup.add(addRow);

        window.set_default_size(720, 620);
        this._loadRules();
    }

    _run(args, onSuccess, privileged = true) {
        if (this._busy)
            return;
        this._busy = true;
        this._setControlsEnabled(false);
        this._status.set_title('Authorizing rule manager…');

        let process;
        try {
            const command = privileged
                ? [PKEXEC_PATH, GATE_PATH, '--manage-rules', ...args]
                : [GATE_PATH, '--manage-rules', ...args];
            process = Gio.Subprocess.new(
                command,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );
        } catch (error) {
            this._finish(error.message);
            return;
        }

        process.communicate_utf8_async(null, null, (proc, result) => {
            try {
                const [, stdout, stderr] = proc.communicate_utf8_finish(result);
                if (!proc.get_successful())
                    throw new Error((stderr || '').trim() || 'Rule management was not authorized.');
                const rules = JSON.parse(stdout);
                if (!Array.isArray(rules))
                    throw new Error('The gate returned invalid rule data.');
                this._rules = rules;
                this._renderRules();
                onSuccess?.();
                this._finish('Rules updated.');
            } catch (error) {
                this._finish(error.message);
            }
        });
    }

    _loadRules() {
        this._run(['list'], null, false);
    }

    _addRule() {
        const resource = this._entry.text.trim();
        if (!resource.startsWith('sudo ') || resource.length > 512 || /[\x00-\x1f\x7f]/.test(resource)) {
            this._status.set_title('Enter a pattern beginning with “sudo ” (up to 512 characters).');
            return;
        }
        const effect = this._effect.selected === 0 ? 'allow' : 'deny';
        this._run(['add', effect, resource], () => this._entry.set_text(''));
    }

    _deleteRule(index, resource) {
        const dialog = new Adw.MessageDialog({
            transient_for: this._window,
            heading: 'Delete permanent rule?',
            body: resource,
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('delete', 'Delete');
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response === 'delete')
                this._run(['delete', String(index), resource]);
        });
        dialog.present();
    }

    _renderRules() {
        for (const group of [this._allowGroup, this._denyGroup]) {
            let child = group.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                group.remove(child);
                child = next;
            }
        }

        const validRules = this._rules
            .map((rule, index) => ({ rule, index }))
            .filter(({ rule }) => rule && rule.action === 'shell' &&
                typeof rule.resource === 'string' && ['allow', 'deny'].includes(rule.effect));

        for (const effect of ['allow', 'deny']) {
            const group = effect === 'allow' ? this._allowGroup : this._denyGroup;
            const matching = validRules.filter(({ rule }) => rule.effect === effect);
            if (matching.length === 0) {
                group.add(new Adw.ActionRow({
                    title: effect === 'allow' ? 'No always-allow rules' : 'No always-deny rules',
                }));
                continue;
            }
            for (const { rule, index } of matching) {
                const row = new Adw.ActionRow({ title: rule.resource });
                row.set_subtitle(`Rule ${index + 1}`);
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: 'Delete rule',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['destructive-action'],
                });
                remove.connect('clicked', () => this._deleteRule(index, rule.resource));
                row.add_suffix(remove);
                group.add(row);
            }
        }
    }

    _setControlsEnabled(enabled) {
        this._entry.sensitive = enabled;
        this._effect.sensitive = enabled;
        this._addButton.sensitive = enabled;
        this._allowGroup.sensitive = enabled;
        this._denyGroup.sensitive = enabled;
    }

    _finish(message) {
        this._busy = false;
        this._setControlsEnabled(true);
        this._status.set_title(message);
        if (message !== 'Rules updated.')
            console.error(`${this.metadata.name}: ${message}`);
    }
}
