'use strict';

(function () {
  const percent = value => Number.isFinite(value) && value >= 0 && value <= 100;
  function readTelemetry(body) {
    const data = body?.data;
    if (body?.ok !== true || body.simulated !== true || !data ||
        ![data.batteryPercent, data.soilMoisturePercent, data.waterTankPercent].every(percent)) {
      throw new Error('Invalid demo telemetry');
    }
    return { battery: data.batteryPercent, moisture: data.soilMoisturePercent, tank: data.waterTankPercent };
  }

  function createTelemetryPoller({
    fetcher, onUpdate, isHidden, schedule = setTimeout, cancel = clearTimeout, interval = 3000
  }) {
    let timer;
    let active;
    let running = false;

    async function request(path, signal) {
      const response = await fetcher('/api/' + path, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Backend request failed');
      return response.json();
    }

    async function poll() {
      if (!running || isHidden() || active) return;
      const controller = new AbortController();
      active = controller;
      const timeout = schedule(() => controller.abort(), 5000);
      try {
        const health = await request('health', controller.signal);
        if (health?.ok !== true || health.simulated !== true || health.data?.status !== 'ok') {
          throw new Error('Invalid backend health response');
        }
        if (!running || isHidden() || controller.signal.aborted) return;
        const telemetry = readTelemetry(await request('rover/status', controller.signal));
        if (running && !isHidden() && !controller.signal.aborted) onUpdate('connected', telemetry);
      } catch {
        if (running && !isHidden() && controller.signal.reason !== 'hidden') onUpdate('offline', null);
      } finally {
        cancel(timeout);
        active = undefined;
        if (running && !isHidden()) timer = schedule(poll, controller.signal.reason === 'hidden' ? 0 : interval);
      }
    }

    return {
      start() {
        if (running) return;
        running = true;
        onUpdate('connecting', null);
        void poll();
      },
      visibilityChanged() {
        cancel(timer);
        if (isHidden()) active?.abort('hidden');
        else void poll();
      },
      stop() {
        running = false;
        cancel(timer);
        active?.abort();
      }
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createTelemetryPoller, readTelemetry };
  else window.AgriRoverApi = { createTelemetryPoller };
})();
