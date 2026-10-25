import { Panel } from './Panel';
import type { SportsEvent } from '@/types';
import type { SportsEventsResult } from '@/services/sports';
import { t } from '@/services/i18n';

type StatusFilter = 'all' | 'live' | 'upcoming' | 'final';

function statusFilterMatches(event: SportsEvent, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'upcoming') return event.status === 'scheduled' || event.status === 'postponed';
  return event.status === filter;
}

function statusLabel(status: SportsEvent['status']): string {
  return t(`components.sportsLive.status.${status}`);
}

function locationLabel(event: SportsEvent): string {
  const location = [event.venue, event.city, event.country].filter(Boolean).join(' · ');
  if (!location) return '';
  return event.coordinateAccuracy === 'approximate'
    ? `${location} (${t('components.sportsLive.approximate')})`
    : location;
}

function teamRow(name: string, logo: string | undefined, score: number | null | undefined): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sports-team';

  if (logo) {
    const image = document.createElement('img');
    image.className = 'sports-team-logo';
    image.src = logo;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    row.appendChild(image);
  }

  const label = document.createElement('span');
  label.className = 'sports-team-name';
  label.textContent = name;
  row.appendChild(label);

  const scoreEl = document.createElement('span');
  scoreEl.className = 'sports-team-score';
  scoreEl.textContent = score == null ? '–' : String(score);
  row.appendChild(scoreEl);
  return row;
}

export class SportsLivePanel extends Panel {
  private result: SportsEventsResult | null = null;
  private statusFilter: StatusFilter = 'all';
  private sportFilter = 'all';
  private onEventClick?: (event: SportsEvent) => void;

  constructor() {
    super({
      id: 'sports-live',
      title: t('panels.sportsLive'),
      showCount: true,
      trackActivity: true,
      infoTooltip: t('components.sportsLive.infoTooltip'),
      defaultRowSpan: 2,
    });
    this.showLoading();
    this.content.addEventListener('click', (event) => {
      const control = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sports-filter]');
      if (control) {
        const kind = control.dataset.sportsFilter;
        if (kind === 'status') this.statusFilter = control.dataset.value as StatusFilter;
        if (kind === 'sport') this.sportFilter = control.dataset.value ?? 'all';
        this.render();
        return;
      }

      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-sports-event-id]');
      const selected = this.result?.events.find(item => item.id === row?.dataset.sportsEventId);
      if (selected) this.onEventClick?.(selected);
    });
  }

  public setEventClickHandler(handler: (event: SportsEvent) => void): void {
    this.onEventClick = handler;
  }

  public setData(result: SportsEventsResult): void {
    this.result = result;
    this.setCount(result.events.length);
    this.render();
  }

  public hasData(): boolean {
    return Boolean(this.result?.events.length);
  }

  private createFilterButton(kind: 'status' | 'sport', value: string, label: string, active: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `panel-tab${active ? ' active' : ''}`;
    button.dataset.sportsFilter = kind;
    button.dataset.value = value;
    button.textContent = label;
    return button;
  }

  private render(): void {
    if (!this.result) return;
    const root = document.createElement('div');
    root.className = 'sports-live-content';

    const demoNotice = document.createElement('div');
    demoNotice.className = 'sports-demo-notice';
    demoNotice.textContent = t('components.sportsLive.demoNotice');
    root.appendChild(demoNotice);

    if (!this.result.configured) {
      const message = document.createElement('div');
      message.className = 'panel-empty';
      message.textContent = t('components.sportsLive.errors.unconfigured');
      root.appendChild(message);
      this.content.replaceChildren(root);
      return;
    }
    if (this.result.error && this.result.events.length === 0) {
      const message = document.createElement('div');
      message.className = 'panel-empty';
      message.textContent = t('components.sportsLive.errors.failedToLoad');
      root.appendChild(message);
      this.content.replaceChildren(root);
      return;
    }

    const statusControls = document.createElement('div');
    statusControls.className = 'panel-tabs sports-status-filters';
    const statuses: Array<[StatusFilter, string]> = [
      ['all', t('components.sportsLive.filters.all')],
      ['live', t('components.sportsLive.filters.live')],
      ['upcoming', t('components.sportsLive.filters.upcoming')],
      ['final', t('components.sportsLive.filters.final')],
    ];
    for (const [value, label] of statuses) {
      statusControls.appendChild(this.createFilterButton('status', value, label, this.statusFilter === value));
    }
    root.appendChild(statusControls);

    const sports = [...new Set(this.result.events.map(event => event.sport).filter(Boolean))];
    if (sports.length > 1) {
      const sportControls = document.createElement('div');
      sportControls.className = 'sports-sport-filters';
      sportControls.appendChild(this.createFilterButton('sport', 'all', t('components.sportsLive.filters.all'), this.sportFilter === 'all'));
      for (const sport of sports) {
        sportControls.appendChild(this.createFilterButton('sport', sport, sport, this.sportFilter === sport));
      }
      root.appendChild(sportControls);
    }

    const filtered = this.result.events.filter(event =>
      statusFilterMatches(event, this.statusFilter)
      && (this.sportFilter === 'all' || event.sport === this.sportFilter)
    );

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'panel-empty';
      empty.textContent = t('components.sportsLive.empty');
      root.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'sports-event-list';
      for (const event of filtered) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `sports-event sports-event-${event.status}`;
        card.dataset.sportsEventId = event.id;

        const meta = document.createElement('div');
        meta.className = 'sports-event-meta';
        const league = document.createElement('span');
        league.textContent = event.league;
        const state = document.createElement('span');
        state.className = `sports-status sports-status-${event.status}`;
        state.textContent = [statusLabel(event.status), event.period, event.clock].filter(Boolean).join(' · ');
        meta.append(league, state);

        const teams = document.createElement('div');
        teams.className = 'sports-teams';
        teams.append(
          teamRow(event.homeTeam, event.homeTeamLogo, event.homeScore),
          teamRow(event.awayTeam, event.awayTeamLogo, event.awayScore),
        );

        const details = document.createElement('div');
        details.className = 'sports-event-details';
        const time = document.createElement('time');
        time.dateTime = event.startTime;
        time.textContent = new Intl.DateTimeFormat(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(new Date(event.startTime));
        details.appendChild(time);
        const location = locationLabel(event);
        if (location) {
          const venue = document.createElement('span');
          venue.textContent = location;
          details.appendChild(venue);
        }

        card.append(meta, teams, details);
        list.appendChild(card);
      }
      root.appendChild(list);
    }

    const attribution = document.createElement('div');
    attribution.className = 'sports-attribution';
    attribution.textContent = t('components.sportsLive.attribution');
    if (this.result.stale) attribution.dataset.stale = 'true';
    root.appendChild(attribution);
    this.content.replaceChildren(root);
  }
}
