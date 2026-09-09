// Grok Weekly desklet — grok-weekly@greyster1
// SuperGrok weekly used % from the same billing snapshot as /usage.

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const ByteArray = imports.byteArray;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Gettext = imports.gettext;
const Tooltips = imports.ui.tooltips;

const UUID = "grok-weekly@greyster1";
const AUTH_PATH = GLib.get_home_dir() + "/.grok/auth.json";
const VERSION_PATH = GLib.get_home_dir() + "/.grok/version.json";
const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const TOKEN_AUTH = "xai-grok-cli";
const IS_SOUP_2 = Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2;
const WARN_USED = 75;
const DANGER_USED = 90;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function GrokWeeklyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

GrokWeeklyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.refreshMinutes = 5;
        this._timer = 0;
        this._httpSession = null;
        this._fetching = false;
        this._used = null;
        this._resetIso = null;
        this._error = null;
        this._updatedAt = null;

        this._initHttp();
        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "refresh-minutes",
            "refreshMinutes",
            this._onRefreshChanged,
            null
        );

        this._root = new St.BoxLayout({
            vertical: true,
            style_class: "gw-desklet",
            reactive: true
        });
        this._caption = new St.Label({
            text: _("GROK"),
            style_class: "gw-caption",
            x_expand: true
        });
        this._pct = new St.Label({
            text: "--%",
            style_class: "gw-pct",
            x_expand: true
        });
        this._reset = new St.Label({
            text: "",
            style_class: "gw-reset",
            x_expand: true
        });
        this._root.add_actor(this._caption);
        this._root.add_actor(this._pct);
        this._root.add_actor(this._reset);
        this.setContent(this._root);
        this.setHeader(_("Grok Weekly"));

        this._tooltip = new Tooltips.Tooltip(this.actor, _("Grok weekly usage"));

        let refresh = new PopupMenu.PopupMenuItem(_("Refresh now"));
        refresh.connect("activate", Lang.bind(this, function () {
            this._fetch();
        }));
        this._menu.addMenuItem(refresh);

        this._render();
        this._fetch();
        this._schedule();
    },

    _initHttp: function () {
        if (IS_SOUP_2) {
            this._httpSession = new Soup.SessionAsync();
            Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());
        } else {
            this._httpSession = new Soup.Session();
        }
        this._httpSession.timeout = 20;
        this._httpSession.idle_timeout = 20;
    },

    _onRefreshChanged: function () {
        this._schedule();
    },

    _clientVersion: function () {
        try {
            let file = Gio.File.new_for_path(VERSION_PATH);
            let [ok, bytes] = file.load_contents(null);
            if (!ok) {
                return "1.0.24";
            }
            let data = JSON.parse(this._bytesToString(bytes));
            return data.version || data.stable_version || "1.0.24";
        } catch (e) {
            return "1.0.24";
        }
    },

    _bytesToString: function (bytes) {
        if (bytes instanceof Uint8Array) {
            return ByteArray.toString(bytes);
        }
        return bytes.toString();
    },

    _readAuth: function () {
        try {
            let file = Gio.File.new_for_path(AUTH_PATH);
            if (!file.query_exists(null)) {
                return null;
            }
            let [ok, bytes] = file.load_contents(null);
            if (!ok) {
                return null;
            }
            let data = JSON.parse(this._bytesToString(bytes));
            let best = null;
            for (let key in data) {
                let entry = data[key];
                if (entry && entry.key && entry.user_id) {
                    if (!best || (entry.expires_at && (!best.expires_at || entry.expires_at > best.expires_at))) {
                        best = entry;
                    }
                }
            }
            return best;
        } catch (e) {
            global.logError(UUID + " failed to read auth.json: " + e);
            return null;
        }
    },

    _fetch: function () {
        if (this._fetching || !this._httpSession) {
            return;
        }
        let auth = this._readAuth();
        if (!auth) {
            this._error = _("Run grok login");
            this._used = null;
            this._resetIso = null;
            this._render();
            return;
        }

        this._fetching = true;
        let message = Soup.Message.new("GET", BILLING_URL);
        try {
            message.request_headers.append("Authorization", "Bearer " + auth.key);
            message.request_headers.append("X-XAI-Token-Auth", TOKEN_AUTH);
            message.request_headers.append("x-userid", auth.user_id);
            message.request_headers.append("x-grok-client-version", this._clientVersion());
            message.request_headers.append("Accept", "application/json");
        } catch (e) {
            this._fetching = false;
            this._error = _("Request failed");
            this._render();
            return;
        }

        if (IS_SOUP_2) {
            this._httpSession.queue_message(message, Lang.bind(this, function (session, msg) {
                this._fetching = false;
                let body = null;
                try {
                    if (msg && msg.response_body) {
                        body = msg.response_body.data;
                    }
                    this._handleResponse(msg ? msg.status_code : 0, body);
                } catch (e) {
                    this._error = _("Parse failed");
                    this._render();
                }
            }));
        } else {
            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, function (session, result) {
                    this._fetching = false;
                    try {
                        let status = message.get_status();
                        let body = null;
                        let bytes = this._httpSession.send_and_read_finish(result);
                        if (bytes) {
                            body = this._bytesToString(bytes.get_data());
                        }
                        this._handleResponse(status, body);
                    } catch (e) {
                        this._error = _("Request failed");
                        this._render();
                    }
                })
            );
        }
    },

    _handleResponse: function (status, body) {
        if (status === 401 || status === 403) {
            this._error = _("Token expired");
            this._used = null;
            this._resetIso = null;
            this._render();
            return;
        }
        if (status !== 200 || !body) {
            this._error = _("HTTP ") + status;
            this._render();
            return;
        }
        try {
            let data = JSON.parse(body);
            let config = data.config || data;
            let used = config.creditUsagePercent;
            if (used === undefined || used === null) {
                let limit = config.monthlyLimit && config.monthlyLimit.val;
                let spent = config.used && config.used.val;
                if (limit > 0 && spent !== undefined && spent !== null) {
                    used = (spent / limit) * 100;
                } else {
                    used = 0;
                }
            }
            used = Number(used);
            if (isNaN(used)) {
                throw new Error("bad percent");
            }
            this._used = Math.max(0, Math.min(100, Math.round(used)));
            let period = config.currentPeriod || {};
            this._resetIso = period.end || config.billingPeriodEnd || null;
            this._error = null;
            this._updatedAt = GLib.DateTime.new_now_local();
            this._render();
        } catch (e) {
            this._error = _("Bad response");
            this._render();
        }
    },

    _formatReset: function (iso) {
        if (!iso) {
            return "";
        }
        try {
            let utc = GLib.DateTime.new_from_iso8601(iso, GLib.TimeZone.new_utc());
            if (!utc) {
                return "";
            }
            return utc.to_local().format("%a %H:%M");
        } catch (e) {
            return "";
        }
    },

    _colorClass: function (used) {
        if (used >= DANGER_USED) {
            return "gw-danger";
        }
        if (used >= WARN_USED) {
            return "gw-warn";
        }
        return "gw-ok";
    },

    _render: function () {
        this._pct.remove_style_class_name("gw-ok");
        this._pct.remove_style_class_name("gw-warn");
        this._pct.remove_style_class_name("gw-danger");
        this._pct.remove_style_class_name("gw-error");

        if (this._error && this._used === null) {
            this._pct.set_text(this._error);
            this._pct.add_style_class_name("gw-error");
            this._reset.set_text("");
            this._tooltip.set_text(this._error + "\n" + _("Right-click to refresh"));
            return;
        }

        let used = this._used;
        if (used === null) {
            this._pct.set_text("--%");
            this._pct.add_style_class_name("gw-ok");
            this._reset.set_text("");
            this._tooltip.set_text(_("Loading Grok weekly usage"));
            return;
        }

        this._pct.set_text(used + "%");
        this._pct.add_style_class_name(this._colorClass(used));
        this._reset.set_text(this._formatReset(this._resetIso));

        let remaining = Math.max(0, 100 - used);
        let lines = [
            _("Grok weekly used: ") + used + "%",
            _("Remaining: ") + remaining + "%"
        ];
        if (this._resetIso) {
            try {
                let utc = GLib.DateTime.new_from_iso8601(this._resetIso, GLib.TimeZone.new_utc());
                if (utc) {
                    lines.push(_("Resets: ") + utc.to_local().format("%a %b %d %H:%M"));
                }
            } catch (e) {
            }
        }
        if (this._updatedAt) {
            lines.push(_("Updated: ") + this._updatedAt.format("%H:%M"));
        }
        lines.push(_("Click to refresh"));
        this._tooltip.set_text(lines.join("\n"));
    },

    _schedule: function () {
        this._stopTimer();
        let minutes = parseInt(this.refreshMinutes, 10);
        if (isNaN(minutes) || minutes < 1) {
            minutes = 5;
        }
        this._timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            minutes * 60,
            Lang.bind(this, function () {
                this._fetch();
                return GLib.SOURCE_CONTINUE;
            })
        );
    },

    _stopTimer: function () {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
    },

    on_desklet_clicked: function () {
        this._fetch();
    },

    on_desklet_removed: function () {
        this._stopTimer();
        if (this._httpSession) {
            try {
                this._httpSession.abort();
            } catch (e) {
            }
        }
    }
};

function main(metadata, deskletId) {
    return new GrokWeeklyDesklet(metadata, deskletId);
}
