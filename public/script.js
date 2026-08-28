(() => {
  'use strict';

  const TIME_ZONE = 'Asia/Tokyo';
  const INITIAL_FILTER = 'next7';
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ja-JP', { timeZone: TIME_ZONE, weekday: 'short' });

  const list = document.querySelector('#schedule-list');
  const message = document.querySelector('#schedule-message');
  const filters = [...document.querySelectorAll('[data-filter]')];
  const noticesPanel = document.querySelector('.notices');
  const noticesList = document.querySelector('.notices-list');
  let schedules = [];
  let activeFilter = INITIAL_FILTER;

  function tokyoParts(date) {
    const parts = Object.fromEntries(DATE_PARTS_FORMATTER.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]));
    return parts;
  }

  function tokyoDateKey(date) {
    const { year, month, day } = tokyoParts(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function dateKeyToUtcMs(key) {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }

  function shiftDateKey(key, days) {
    const shifted = new Date(dateKeyToUtcMs(key) + days * 86400000);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
  }

  function weekRange(now) {
    const today = tokyoDateKey(now);
    const dayOfWeek = new Date(dateKeyToUtcMs(today)).getUTCDay();
    const start = shiftDateKey(today, -dayOfWeek);
    return { start, end: shiftDateKey(start, 6) };
  }

  function formatDate(start) {
    const { year, month, day } = tokyoParts(start);
    return { year, label: `${month}/${day}`, weekday: WEEKDAY_FORMATTER.format(start) };
  }

  function formatTimeRange(start, end) {
    const startParts = tokyoParts(start);
    const startLabel = `${String(startParts.hour).padStart(2, '0')}:${String(startParts.minute).padStart(2, '0')}`;
    if (start.getTime() === end.getTime()) return startLabel;
    const endParts = tokyoParts(end);
    const startKey = tokyoDateKey(start);
    const endKey = tokyoDateKey(end);
    if (startKey !== endKey && end.getTime() - start.getTime() >= TWELVE_HOURS_MS) {
      const endDate = formatDate(end);
      const endYear = endDate.year !== startParts.year ? `${endDate.year}年` : '';
      const endTime = `${String(endParts.hour).padStart(2, '0')}:${String(endParts.minute).padStart(2, '0')}`;
      return `${startLabel} ～ ${endYear}${endDate.label}（${endDate.weekday}） ${endTime}`;
    }
    const daysAfterStart = Math.round((dateKeyToUtcMs(endKey) - dateKeyToUtcMs(startKey)) / 86400000);
    const endHour = endParts.hour + Math.max(0, daysAfterStart) * 24;
    return `${startLabel} ～ ${String(endHour).padStart(2, '0')}:${String(endParts.minute).padStart(2, '0')}`;
  }

  function getStatus(schedule, now) {
    if (now.getTime() < schedule.start.getTime()) return 'UPCOMING';
    if (now.getTime() < schedule.end.getTime()) return 'LIVE';
    return 'ENDED';
  }

  function validYouTubeUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      const allowedHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'];
      return url.protocol === 'https:' && allowedHosts.includes(url.hostname) ? url.href : '';
    } catch {
      return '';
    }
  }

  function validHttpsUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function normaliseSchedule(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('予定データがオブジェクトではありません。');
    if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error('id が不足しています。');
    if (typeof raw.title !== 'string' || !raw.title.trim()) throw new Error(`${raw.id}: title が不足しています。`);
    if (typeof raw.start !== 'string' || typeof raw.end !== 'string') throw new Error(`${raw.id}: start または end が不足しています。`);
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw.start) || !/(Z|[+-]\d{2}:\d{2})$/i.test(raw.end)) {
      throw new Error(`${raw.id}: start と end はタイムゾーン付きISO日時で指定してください。`);
    }
    const start = new Date(raw.start);
    const end = new Date(raw.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error(`${raw.id}: 日時の形式または開始・終了時刻が不正です。`);
    const category = typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : '配信';
    return {
      id: raw.id, title: raw.title.trim(), start, end,
      category,
      content: typeof raw.content === 'string' ? raw.content.trim() : '',
      description: typeof raw.description === 'string' ? raw.description.trim() : '',
      youtubeUrl: isOfficialCategory(category) ? validHttpsUrl(raw.youtubeUrl) : validYouTubeUrl(raw.youtubeUrl)
    };
  }

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function categoryClassName(category) {
    if (category === '本配信') return 'category category-main';
    if (category === '突発配信') return 'category category-special';
    if (isOfficialCategory(category)) return 'category category-official';
    return 'category';
  }

  function isOfficialCategory(category) {
    return category === 'FF14公式' || category === 'FF公式';
  }

  function createCard(schedule, status) {
    const statusText = { UPCOMING: '配信予定', LIVE: '配信中', ENDED: 'アーカイブ' }[status];
    const isOfficial = isOfficialCategory(schedule.category);
    const card = document.createElement('article');
    card.className = `schedule-card${status === 'LIVE' ? ' is-live' : ''}`;
    card.setAttribute('aria-label', `${schedule.title}、${statusText}`);
    const top = document.createElement('div');
    top.className = 'card-top';
    const formattedDate = formatDate(schedule.start);
    const date = createTextElement('p', 'date', '');
    date.append(createTextElement('span', 'year', `${formattedDate.year}年`));
    date.append(document.createTextNode(formattedDate.label));
    const weekday = createTextElement('span', 'weekday', `（${formattedDate.weekday}）`);
    date.append(weekday);
    top.append(date);
    if (!isOfficial) {
      const statusClass = { UPCOMING: 'status-upcoming', LIVE: 'status-live', ENDED: 'status-archive' }[status];
      const statusLabel = createTextElement('p', `status ${statusClass}`, statusText);
      top.append(statusLabel);
    }
    card.append(top);
    card.append(createTextElement('p', 'time', formatTimeRange(schedule.start, schedule.end)));
    card.append(createTextElement('p', categoryClassName(schedule.category), schedule.category));
    card.append(createTextElement('h3', 'title', schedule.title));
    if (schedule.content) card.append(createTextElement('p', 'content-name', schedule.content));
    if (schedule.description) card.append(createTextElement('p', 'description', schedule.description));
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    if (schedule.youtubeUrl) {
      const link = document.createElement('a');
      link.className = `youtube-link${isOfficial ? ' official-link' : ''}`;
      link.href = schedule.youtubeUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const linkText = isOfficial ? '公式情報を見る' : 'YouTubeで見る';
      link.textContent = linkText;
      link.setAttribute('aria-label', isOfficial
        ? `${schedule.title}の公式情報を見る（新しいタブで開く）`
        : `${schedule.title}をYouTubeで見る（新しいタブで開く）`);
      footer.append(link);
    }
    card.append(footer);
    return card;
  }

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `schedule-message${kind ? ` is-${kind}` : ''}`;
  }

  function renderNotices(notices) {
    noticesList.replaceChildren();
    noticesPanel.hidden = notices.length === 0;
    notices.forEach((notice) => {
      const item = document.createElement('li');
      if (notice.heading) {
        const heading = createTextElement('strong', 'notice-item-title', notice.heading);
        item.append(heading, document.createTextNode('：'));
      }
      item.append(document.createTextNode(notice.body));
      noticesList.append(item);
    });
  }

  async function loadNotices() {
    try {
      const response = await fetch('/api/notices', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('お知らせAPIのレスポンスが配列ではありません。');
      const notices = data.map((notice) => ({
        heading: typeof notice?.heading === 'string' ? notice.heading.trim() : '',
        body: typeof notice?.body === 'string' ? notice.body.trim() : ''
      })).filter((notice) => notice.body);
      renderNotices(notices);
    } catch (error) {
      console.warn('お知らせAPIを読み込めないため、固定のお知らせを表示します:', error);
    }
  }

  function isWithinFilter(schedule, filter, now) {
    const startKey = tokyoDateKey(schedule.start);
    if (filter === 'today') return startKey === tokyoDateKey(now);
    if (filter === 'week') {
      const range = weekRange(now);
      return startKey >= range.start && startKey <= range.end;
    }
    if (filter === 'next7') {
      const startTime = schedule.start.getTime();
      return startTime >= now.getTime() && startTime <= now.getTime() + SEVEN_DAYS_MS;
    }
    return getStatus(schedule, now) !== 'ENDED';
  }

  function render() {
    const now = new Date();
    const visible = schedules.filter((schedule) => isWithinFilter(schedule, activeFilter, now));
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    if (!visible.length) {
      setMessage('この期間に表示できる配信予定はありません。', 'empty');
      return;
    }
    setMessage('');
    visible.forEach((schedule) => list.append(createCard(schedule, getStatus(schedule, now))));
  }

  function setFilter(filter) {
    activeFilter = filter;
    filters.forEach((button) => {
      const selected = button.dataset.filter === filter;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    render();
  }

  async function loadSchedules() {
    try {
      const response = await fetch('/api/schedules', { cache: 'no-store' });
      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = typeof errorData.detail === 'string' ? errorData.detail : '';
        } catch {
          // JSON以外のエラーレスポンスでは共通メッセージを使用する。
        }
        throw new Error(detail || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('配信予定APIのレスポンスが配列ではありません。');
      schedules = data.map(normaliseSchedule).sort((a, b) => a.start - b.start);
      setFilter(INITIAL_FILTER);
    } catch (error) {
      list.replaceChildren();
      list.setAttribute('aria-busy', 'false');
      const detail = /^\d+行目/.test(error?.message || '') ? ` ${error.message}` : '';
      setMessage(`配信予定を読み込めませんでした。${detail || ' 時間をおいて再読み込みしてください。'}`, 'error');
      console.error('配信予定APIの読み込みまたは形式のエラー:', error);
    }
  }

  filters.forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  loadNotices();
  loadSchedules();
  window.setInterval(render, 30000);
})();
