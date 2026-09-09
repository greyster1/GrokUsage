// Grok Usage applet — grok-usage@greyster1
// Circular SuperGrok weekly used % on the Cinnamon panel.

const Applet = imports.ui.applet;
const St = imports.gi.St;
const Cairo = imports.cairo;
const Pango = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;
const Soup = imports.gi.Soup;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const ByteArray = imports.byteArray;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;

const UUID = "grok-usage@greyster1";
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

function hexRgb(hex) {
    let n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const COLOR_OK = hexRgb("#8b5cf6");
const COLOR_WARN = hexRgb("#f59e0b");
const COLOR_DANGER = hexRgb("#ef4444");
const COLOR_BG = hexRgb("#1e1e2e");
const COLOR_TEXT = hexRgb("#e0e0e0");

function GrokUsageApplet(orientation, panelHeight, instanceId) {
    this._init(orientation, panelHeight, instanceId);
}

GrokUsageApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function (orientation, panelHeight, instanceId) {
        Applet.Applet.prototype._init.call(this, orientation, panelHeight, instanceId);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.actor.add_style_class_name("grok-usage-applet");

        this.refreshMinutes = 5;
        this._timer = 0;
        this._httpSession = null;
        this._fetching = false;
        this._used = null;
        this._resetIso = null;
        this._error = null;
        this._updatedAt = null;

        this._area = new St.DrawingArea({
            style_class: "grok-usage-area",
            reactive: false
        });
        this._area.connect("repaint", Lang.bind(this, this._onRepaint));
        this.actor.add(this._area, { x_fill: false, y_fill: false, x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });

        this._initHttp();
        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind("refresh-minutes", "refreshMinutes", Lang.bind(this, this._onRefreshChanged));

        this._sizeArea();
        this.set_applet_tooltip(_("Grok weekly usage"));
        this._fetch();
        this._schedule();
    },

    _sizeArea: function () {
        let panel = 24;
        try {
            panel = this._panelHeight || 24;
        } catch (e) {
        }
        let size = Math.max(18, panel - 6);
        this._area.set_width(size);
        this._area.set_height(size);
        this._area.queue_repaint();
    },

    on_panel_height_changed: function () {
        this._sizeArea();
    },

    on_orientation_changed: function () {
        this._sizeArea();
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

    _accent: function () {
        if (this._error && this._used === null) {
            return COLOR_DANGER;
        }
        let used = this._used;
        if (used === null) {
            return COLOR_OK;
        }
        if (used >= DANGER_USED) {
            return COLOR_DANGER;
        }
        if (used >= WARN_USED) {
            return COLOR_WARN;
        }
        return COLOR_OK;
    },

    _onRepaint: function (area) {
        let cr = area.get_context();
        let [width, height] = area.get_surface_size();
        let size = Math.min(width, height);
        let xc = width / 2;
        let yc = height / 2;
        let line = Math.max(2.2, size * 0.11);
        let radius = size / 2 - line / 2 - 0.5;
        let accent = this._accent();

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        cr.arc(xc, yc, radius - line * 0.15, 0, Math.PI * 2);
        cr.setSourceRGB(COLOR_BG[0], COLOR_BG[1], COLOR_BG[2]);
        cr.fill();

        cr.setLineWidth(line);
        cr.setLineCap(Cairo.LineCap.ROUND);

        cr.setSourceRGBA(1, 1, 1, 0.16);
        cr.arc(xc, yc, radius, 0, Math.PI * 2);
        cr.stroke();

        let used = this._used;
        if (used !== null && used > 0) {
            let frac = Math.max(0, Math.min(1, used / 100));
            let start = -Math.PI / 2;
            let end = start + frac * Math.PI * 2;
            cr.setSourceRGB(accent[0], accent[1], accent[2]);
            if (frac >= 0.995) {
                cr.arc(xc, yc, radius, 0, Math.PI * 2);
            } else {
                cr.arc(xc, yc, radius, start, end);
            }
            cr.stroke();
        }

        let label = "--";
        if (this._error && this._used === null) {
            label = "!";
        } else if (used !== null) {
            label = String(used);
        }

        let layout = PangoCairo.create_layout(cr);
        let px = label.length >= 3 ? Math.max(7, Math.round(size * 0.28)) : Math.max(8, Math.round(size * 0.36));
        layout.set_font_description(Pango.FontDescription.from_string("Sans Bold " + px));
        layout.set_text(label, -1);
        let [tw, th] = layout.get_pixel_size();
        cr.setSourceRGB(accent[0], accent[1], accent[2]);
        cr.moveTo(xc - tw / 2, yc - th / 2);
        PangoCairo.show_layout(cr, layout);

        cr.$dispose();
    },

    _updateTooltip: function () {
        if (this._error && this._used === null) {
            this.set_applet_tooltip(this._error + "\n" + _("Click to refresh"));
            return;
        }
        if (this._used === null) {
            this.set_applet_tooltip(_("Loading Grok weekly usage"));
            return;
        }
        let lines = [
            _("Grok weekly used: ") + this._used + "%",
            _("Remaining: ") + Math.max(0, 100 - this._used) + "%"
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
        this.set_applet_tooltip(lines.join("\n"));
    },

    _render: function () {
        this._area.queue_repaint();
        this._updateTooltip();
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

    on_applet_clicked: function () {
        this._fetch();
    },

    on_applet_removed_from_panel: function () {
        this._stopTimer();
        if (this._httpSession) {
            try {
                this._httpSession.abort();
            } catch (e) {
            }
        }
    }
};

function main(metadata, orientation, panelHeight, instanceId) {
    return new GrokUsageApplet(orientation, panelHeight, instanceId);
}
