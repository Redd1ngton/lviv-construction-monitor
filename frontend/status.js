/* Public run steps plus a separate, periodically published parser heartbeat. */
(() => {
  const repo = 'Redd1ngton/lviv-construction-monitor';
  const api = `https://api.github.com/repos/${repo}/actions`;
  const stages = ['Підготовка', 'Встановлення', 'Перевірки', 'Збір карток', 'Публікація'];
  const labels = {starting: 'Підключення до реєстру', listing: 'Читання сторінки реєстру',
    coordinates: 'Отримання координат із карти реєстру', details: 'Обробка карток', saving: 'Збереження JSON і CSV', publishing: 'Публікація даних'};
  let latestHeartbeat = null;
  let run = null, jobs = [], lastApi = 0, lastCheck = null, apiError = '', busy = false;
  const el = id => document.getElementById(id);
  async function get(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error(String(response.status));
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  function date(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('uk-UA');
  }
  function stepIndex(name) {
    if (name.startsWith("Post ")) return -1;
    if (/checkout|Set up job/.test(name)) return 0;
    if (/setup-python|pip install/.test(name)) return 1;
    if (/unittest/.test(name)) return 2;
    if (/Collect and verify/.test(name)) return 3;
    if (/Prepare standalone|Commit successful|Publish final/.test(name)) return 4;
    return -1;
  }
  function render(heartbeat) {
    const sameRun = run && heartbeat && String(heartbeat.run_id) === String(run.id) &&
      String(heartbeat.run_attempt || '1') === String(run.run_attempt || '1');
    const state = sameRun ? heartbeat : null;
    const completed = run?.status === 'completed';
    const success = completed && run.conclusion === 'success';
    const failed = completed && !success;
    const active = run?.status === 'in_progress';
    const terminalHeartbeat = state && ['success', 'failure', 'cancelled'].includes(state.stage);
    const title = success ? '✓ Завершено' : failed ? '⚠ ' + (run.conclusion === 'cancelled' ? 'Скасовано' : 'Помилка запуску') :
      active ? '● Працює' : run ? 'Очікує запуску' : apiError ? 'Стан недоступний' : 'Запусків ще немає';
    el('parser-state').textContent = title;
    el('parser-state').dataset.kind = success ? 'success' : failed ? 'failure' : active ? 'active' : '';
    if (run) el('parser-run').href = run.html_url;
    const statuses = stages.map(() => 'pending');
    for (const step of jobs) {
      const index = stepIndex(step.name);
      if (index < 0) continue;
      if (step.conclusion && !['success', 'skipped'].includes(step.conclusion)) statuses[index] = 'failure';
      else if (step.status === 'in_progress') statuses[index] = 'active';
      else if (step.conclusion === 'success' && statuses[index] === 'pending') statuses[index] = 'done';
    }
    if (success) statuses.fill('done');
    el('parser-steps').replaceChildren(...stages.map((name, index) => {
      const li = document.createElement('li');
      li.dataset.state = statuses[index];
      li.textContent = `${statuses[index] === 'done' ? '✓' : statuses[index] === 'active' ? '●' : statuses[index] === 'failure' ? '!' : index + 1} ${name}`;
      if (statuses[index] === 'active') li.setAttribute('aria-current', 'step');
      return li;
    }));
    const detail = [];
    if (run) detail.push(`Запуск №${run.run_number} · Початок: ${date(run.run_started_at || run.created_at)}`);
    if (state) {
      if (!completed) detail.push(labels[state.stage] || (terminalHeartbeat ? 'Завершення запуску' : 'Оновлення стану'));
      if (state.page) detail.push(`Сторінка: ${state.page}`);
      if (Number.isFinite(state.processed)) detail.push(`Оброблено: ${state.processed}${state.total ? ' із приблизно ' + state.total : ''}`);
      if (Number.isFinite(state.accepted)) detail.push(`Підтверджено: ${state.accepted}`);
      if (active && Date.now() - new Date(state.updated_at).getTime() > 300000)
        detail.push('⚠ Понад 5 хвилин без нових даних. Перевірте журнал запуску.');
      if (failed && state.message) detail.push(state.message);
    } else if (active) detail.push('Збір триває. Детальні лічильники з’являться з наступного запуску.');
    if (failed) detail.push('Останні успішно збережені дані залишаються доступними. Причина — у журналі запуску.');
    if (apiError) detail.push('Не вдалося оновити стан GitHub. Показано останню отриману інформацію.');
    if (!run) detail.push(apiError ? 'Перевірте підключення або відкрийте журнал запусків.' : 'Щоденний запуск о 04:17 UTC.');
    el('parser-detail').textContent = detail.join(' · ');
    const bar = el('parser-progress');
    bar.hidden = !(state && state.total > 0 && (active || success));
    bar.value = success ? 100 : Math.min(99, Math.round(100 * (state?.processed || 0) / (state?.total || 1)));
    el('parser-time').textContent = `${state ? 'Остання активність парсера: ' + date(state.updated_at) + ' · ' : ''}Перевірено: ${date(lastCheck)} · Статус перевіряється автоматично`;
  }
  async function refresh(force = false) {
    if (busy) return;
    busy = true;
    el('parser-refresh').disabled = true;
    try {
      if (force || Date.now() - lastApi > 180000) {
        try {
          const data = await get(`${api}/runs?per_page=5`);
          const runs = data.workflow_runs.filter(r => r.path === '.github/workflows/daily-scrape.yml');
          run = runs.find(r => r.status === 'in_progress') || runs[0] || null;
          jobs = run ? (await get(`${api}/runs/${run.id}/jobs`)).jobs.flatMap(j => j.steps || []) : [];
          apiError = '';
        } catch (error) { apiError = error.message; }
        lastApi = Date.now();
      }
      try {
        latestHeartbeat = await get(`https://raw.githubusercontent.com/${repo}/parser-status/status.json?t=${Math.floor(Date.now() / 20000)}`);
      } catch (_) { /* Existing runs may not yet have a progress snapshot. */ }
      lastCheck = new Date().toISOString();
      render(latestHeartbeat);
    } finally { busy = false; el('parser-refresh').disabled = false; }
  }
  el('parser-refresh').addEventListener('click', () => refresh(true));
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
})();

