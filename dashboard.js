/**
 * dashboard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Loaded dynamically by index.html after the patient "Enter" button is clicked.
 * acuity_client.js is injected just before this file, so window.onMqttVitals
 * is available by the time the first MQTT message arrives.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────
    // 1. MQTT CONFIGURATION
    // ─────────────────────────────────────────
    var MQTT_BROKER = 'wss://b5f0030d834f4e039de7475b27f3665f.s1.eu.hivemq.cloud:8884/mqtt';
    var MQTT_USER   = 'Dolly';
    var MQTT_PASS   = 'Dolly1234';
    var MQTT_TOPIC  = 'device/vitals';

    // ─────────────────────────────────────────
    // 2. ELAPSED TIME COUNTER
    // ─────────────────────────────────────────
    var elapsedSeconds = 0;
    setInterval(function () {
        elapsedSeconds++;
        var h = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
        var m = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
        var s = String(elapsedSeconds % 60).padStart(2, '0');
        var el = document.getElementById('elapsedTime');
        if (el) el.innerText = h + ':' + m + ':' + s;
    }, 1000);

    // ─────────────────────────────────────────
    // 3. CHART FACTORY
    // ─────────────────────────────────────────
    var MAX_POINTS = 150;

    function createChart(canvasId, color, yMin, yMax) {
        var ctx = document.getElementById(canvasId);
        if (!ctx) return null;

        // Clear the flat-line placeholder drawn by index.html
        var parent = ctx.parentElement;
        ctx.width  = parent.clientWidth  || 300;
        ctx.height = parent.clientHeight || 120;

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(MAX_POINTS).fill(''),
                datasets: [{
                    data:        Array(MAX_POINTS).fill(null),
                    borderColor: color,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill:        false,
                    tension:     0.3
                }]
            },
            options: {
                responsive:          true,
                maintainAspectRatio: false,
                animation:           false,
                scales: {
                    y: {
                        min:   yMin,
                        max:   yMax,
                        ticks: { display: true, font: { size: 9 }, color: '#888' },
                        grid:  { color: '#eee' }
                    },
                    x: { display: false }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    var ecgChart = createChart('ecgChart', '#006400', -1000, 1500);
    var ppgChart = createChart('ppgChart', '#00008b',  -300,  300);
    var rrChart  = createChart('rrChart',  '#8b4513',  -600,  600);

    // ─────────────────────────────────────────
    // 4. SCROLL HELPER
    // ─────────────────────────────────────────
    function scrollChart(chart, value) {
        if (!chart || value === undefined || value === null) return;
        var d = chart.data.datasets[0].data;
        d.push(parseFloat(value));
        if (d.length > MAX_POINTS) d.shift();
        chart.update('none');
    }

    // ─────────────────────────────────────────
    // 5. DRIP-FEED QUEUE (ECG & PPG)
    // 25 samples/packet → release one every 40ms → smooth 25Hz scroll
    // ─────────────────────────────────────────
    var DRIP_MS = 40;
    var queues  = { ecg: [], ppg: [] };

    function enqueueWaveform(queue, payload) {
        if (Array.isArray(payload)) {
            payload.forEach(function (v) { queue.push(parseFloat(v)); });
        } else if (payload !== undefined && payload !== null) {
            queue.push(parseFloat(payload));
        }
        // Safety cap: trim if >3 s of samples build up
        if (queue.length > 75) queue.splice(0, queue.length - 50);
    }

    // ─────────────────────────────────────────
    // 6. SINUSOIDAL RR WAVE (generated locally)
    // ─────────────────────────────────────────
    var rrBrpm  = 15.0;
    var rrPhase = 0.0;
    var RR_AMP  = 450;
    var TWO_PI  = 2 * Math.PI;

    function rrPhaseStep() {
        return TWO_PI * rrBrpm / 1500;
    }

    // ─────────────────────────────────────────
    // 7. UNIFIED 40ms TICKER
    // ─────────────────────────────────────────
    setInterval(function () {
        if (queues.ecg.length > 0) scrollChart(ecgChart, queues.ecg.shift());
        if (queues.ppg.length > 0) scrollChart(ppgChart, queues.ppg.shift());

        rrPhase += rrPhaseStep();
        if (rrPhase > TWO_PI) rrPhase -= TWO_PI;
        scrollChart(rrChart, Math.sin(rrPhase) * RR_AMP);
    }, DRIP_MS);

    // ─────────────────────────────────────────
    // 8. CONNECTION STATUS WATCHDOG
    // ─────────────────────────────────────────
    var lastUpdateTime = null;

    setInterval(function () {
        var dot  = document.getElementById('statusDot');
        var text = document.getElementById('statusText');
        if (!dot || !text) return;

        if (!lastUpdateTime) {
            dot.style.background = '#f0ad4e';
            text.innerText = 'Waiting...';
            return;
        }
        var secsSince = (Date.now() - lastUpdateTime) / 1000;
        dot.style.background = secsSince < 5 ? '#28a745' : '#dc3545';
        text.innerText       = secsSince < 5 ? 'LIVE'    : 'Signal Lost';
    }, 2000);

    // ─────────────────────────────────────────
    // 9. SUMMARY LOGGER
    // ─────────────────────────────────────────
    var historyLog  = [];
    var MAX_HISTORY = 10;

    function updateSummaryTable() {
        var container = document.getElementById('summaryTable');
        if (!container || historyLog.length === 0) return;

        var html = '<table style="width:100%;border-collapse:collapse;font-size:10px">'
            + '<thead><tr style="border-bottom:1px solid #ccc;font-weight:bold">'
            + '<td>Time</td><td>HR</td><td>SpO2</td><td>RR</td><td>Temp</td><td>HRV</td>'
            + '</tr></thead><tbody>';

        var rows = historyLog.slice().reverse();
        rows.forEach(function (e) {
            html += '<tr style="border-bottom:1px solid #eee">'
                + '<td>' + e.time + '</td>'
                + '<td>' + (e.HR   ? Math.round(e.HR)  : '--') + '</td>'
                + '<td>' + (e.SpO2 ? e.SpO2.toFixed(1) : '--') + '%</td>'
                + '<td>' + (e.RR   ? e.RR.toFixed(1)   : '--') + '</td>'
                + '<td>' + (e.TEMP ? e.TEMP.toFixed(1) : '--') + '°C</td>'
                + '<td>' + (e.HRV  ? e.HRV.toFixed(1)  : '--') + '</td>'
                + '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ─────────────────────────────────────────
    // 10. MQTT CLIENT
    // ─────────────────────────────────────────
    var client = mqtt.connect(MQTT_BROKER, {
        username:        MQTT_USER,
        password:        MQTT_PASS,
        reconnectPeriod: 2000,
        keepalive:       60
    });

    client.on('connect', function () {
        console.log('[dashboard] MQTT connected');
        client.subscribe(MQTT_TOPIC, function (err) {
            if (err) console.error('[dashboard] Subscribe error:', err);
            else     console.log('[dashboard] Subscribed: ' + MQTT_TOPIC);
        });
    });

    client.on('reconnect', function () {
        var dot  = document.getElementById('statusDot');
        var text = document.getElementById('statusText');
        if (dot)  dot.style.background = '#f0ad4e';
        if (text) text.innerText = 'Reconnecting...';
    });

    client.on('error', function (err) {
        console.error('[dashboard] MQTT error:', err);
    });

    // Expose client so index.html's NIBP/notes helpers can reuse it
    window.mqttClient = client;

    // ─────────────────────────────────────────
    // 11. MESSAGE HANDLER
    // ─────────────────────────────────────────
    client.on('message', function (topic, message) {
        try {
            var data = JSON.parse(message.toString());
            lastUpdateTime = Date.now();

            function set(id, val) {
                var el = document.getElementById(id);
                if (el) el.innerText = (val !== undefined && val !== null) ? val : '--';
            }

            // ── Numeric vitals display ──────────────────────────────────────
            var hr = data.HR ? Math.round(data.HR) : null;
            // Clamp display to 50–100 but keep true value for acuity
            set('hrVal',   hr !== null ? Math.max(50, Math.min(100, hr)) : '--');
            set('spo2Val', data.SpO2 ? data.SpO2.toFixed(1) : '--');
            set('rrVal',   data.RR   ? data.RR.toFixed(1)   : '--');
            set('tempVal', data.TEMP ? data.TEMP.toFixed(2)  : '--');
            set('hrvVal',  data.HRV  ? data.HRV.toFixed(1)  : '--');

            var tsEl = document.getElementById('lastUpdate');
            if (tsEl) tsEl.innerText = new Date().toLocaleTimeString();

            // ── Update RR breath rate for sine generator ────────────────────
            if (data.RR && data.RR > 0) rrBrpm = data.RR;

            // ── Waveform queues ─────────────────────────────────────────────
            enqueueWaveform(queues.ecg, data.ECG);
            enqueueWaveform(queues.ppg, data.PPG);

            // ── History log ─────────────────────────────────────────────────
            historyLog.push({
                time: new Date().toLocaleTimeString(),
                HR:   data.HR,
                SpO2: data.SpO2,
                RR:   data.RR,
                TEMP: data.TEMP,
                HRV:  data.HRV
            });
            if (historyLog.length > MAX_HISTORY) historyLog.shift();
            updateSummaryTable();

            // ── Acuity Index ────────────────────────────────────────────────
            // window.onMqttVitals is defined by acuity_client.js which is
            // injected into the page just before dashboard.js.
            // It computes the score, updates the UI, and sets FORECAST_VITALS.
            if (typeof window.onMqttVitals === 'function') {
                window.onMqttVitals({
                    HR:   data.HR,
                    RR:   data.RR,
                    SpO2: data.SpO2,
                    TEMP: data.TEMP
                });
            } else {
                // acuity_client not yet loaded — retry on next tick
                console.warn('[dashboard] onMqttVitals not ready yet');
            }

        } catch (e) {
            console.error('[dashboard] JSON parse error:', e);
        }
    });

    console.log('[dashboard] loaded');

}());