import type { BlockSpan, DayUsage } from '../types'

// The desktop draws an Svg as an isolated image, so it cannot read the app's CSS variables; the light and dark steps live here and switch on the OS scheme.
const LIGHT_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const DARK_SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const LIGHT_HEAT = ['#f0efec', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']
const DARK_HEAT = ['#2b2b29', '#0d366b', '#104281', '#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4']

const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif'

function style(): string {
	const slots = (prefix: string, prop: string, colors: string[]) =>
		colors.map((c, i) => `.${prefix}${i}{${prop}:${c}}`).join('')
	return `<style>
.ink{fill:#0b0b0b}.muted{fill:#6b6a66}.grid{stroke:#e4e3df;stroke-width:1}.base{stroke:#b9b8b3;stroke-width:1}
.avg{stroke:#0b0b0b;stroke-width:2;fill:none}.prev{stroke:#9a9994;stroke-width:2;fill:none;stroke-dasharray:4 3}
.hit{fill:transparent}.hit:hover{fill:rgba(127,127,127,.12)}
${slots('s', 'fill', LIGHT_SERIES)}${slots('l', 'stroke', LIGHT_SERIES)}${slots('h', 'fill', LIGHT_HEAT)}
@media (prefers-color-scheme: dark){
.ink{fill:#fff}.muted{fill:#c3c2b7}.grid{stroke:#383835}.base{stroke:#5c5b57}.avg{stroke:#fff}.prev{stroke:#8a8984}
${slots('s', 'fill', DARK_SERIES)}${slots('l', 'stroke', DARK_SERIES)}${slots('h', 'fill', DARK_HEAT)}
}
text{font-family:${FONT};font-size:11px}
</style>`
}

function svg(width: number, height: number, body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${style()}${body}</svg>`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const money = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(n >= 100 ? 0 : 2)}`)
const shortModel = (m: string) => m.replace(/^claude-/, '')
const slot = (models: string[], model: string) => Math.max(0, models.indexOf(model)) % LIGHT_SERIES.length

export function parseDate(date: string): Date {
	const [y, m, d] = date.split('-').map(Number)
	return new Date(y, m - 1, d)
}

export function dateKey(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const monthDay = (date: string) => parseDate(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// The axis max is four round steps, so every gridline lands on a readable value.
function niceMax(value: number): number {
	const raw = Math.max(value, 0.01) / 4
	const magnitude = 10 ** Math.floor(Math.log10(raw))
	const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => s * magnitude >= raw) ?? 10
	return step * magnitude * 4
}

const axisMoney = (n: number) => (n >= 1000 ? `$${+(n / 1000).toFixed(1)}k` : n >= 10 || n === 0 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

function yAxis(max: number, left: number, right: number, top: number, bottom: number): string {
	let out = ''
	for (let i = 0; i <= 4; i++) {
		const v = (max / 4) * i
		const y = bottom - ((bottom - top) * i) / 4
		out += `<line class="${i === 0 ? 'base' : 'grid'}" x1="${left}" x2="${right}" y1="${y}" y2="${y}"/>`
		out += `<text class="muted" x="${left - 6}" y="${y + 4}" text-anchor="end">${axisMoney(v)}</text>`
	}
	return out
}

type LegendItem = { label: string; swatch: (x: number, y: number) => string }

const LEGEND_ROW = 18

/** Lays the legend out in rows that wrap at `maxX`; the chart reserves the returned height above its plot. */
function legend(items: LegendItem[], x: number, maxX: number): { svg: string; height: number } {
	let out = ''
	let cx = x
	let cy = 10
	for (const item of items) {
		const itemWidth = 16 + item.label.length * 6.5 + 18
		if (cx > x && cx + itemWidth > maxX) {
			cx = x
			cy += LEGEND_ROW
		}
		out += `${item.swatch(cx, cy)}<text class="ink" x="${cx + 16}" y="${cy + 4}">${esc(item.label)}</text>`
		cx += itemWidth
	}
	return { svg: out, height: cy + 10 }
}

const modelSwatches = (used: string[], models: string[]): LegendItem[] =>
	used.map(m => ({
		label: shortModel(m),
		swatch: (x, y) => `<rect class="s${slot(models, m)}" x="${x}" y="${y - 5}" width="10" height="10" rx="2"/>`,
	}))

/** Fills the days with no activity so time reads evenly along the axis. */
export function fillDays(days: DayUsage[], from: Date, to: Date): DayUsage[] {
	const byDate = new Map(days.map(d => [d.date, d]))
	const out: DayUsage[] = []
	for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
		const key = dateKey(d)
		out.push(byDate.get(key) ?? { date: key, cost: 0, tokens: 0, byModel: {} })
	}
	return out
}

export function dailyChart(days: DayUsage[], models: string[], width: number): string {
	const used = models.filter(m => days.some(d => (d.byModel[m] ?? 0) > 0))
	const key = legend(
		[...modelSwatches(used, models), { label: '7-day average', swatch: (x, y) => `<line class="avg" x1="${x}" x2="${x + 12}" y1="${y}" y2="${y}"/>` }],
		48,
		width - 8,
	)
	const height = 220 + key.height
	const [left, right, top, bottom] = [48, width - 8, key.height + 12, height - 24]
	const max = niceMax(Math.max(...days.map(d => d.cost), 0.01))
	const band = (right - left) / days.length
	const barW = Math.max(1, band - 2)
	const y = (v: number) => bottom - ((bottom - top) * v) / max
	let body = key.svg + yAxis(max, left, right, top, bottom)

	days.forEach((d, i) => {
		const x = left + i * band + (band - barW) / 2
		let base = 0
		for (const m of used) {
			const v = d.byModel[m] ?? 0
			if (v <= 0) continue
			const y0 = y(base)
			const y1 = y(base + v)
			// A 2px surface gap separates a segment from the one below it, but only when the segment is tall enough to keep a visible fill.
			const gap = base > 0 && y0 - y1 > 3 ? 2 : 0
			body += `<rect class="s${slot(models, m)}" x="${x}" y="${y1}" width="${barW}" height="${Math.max(0.5, y0 - y1 - gap)}" rx="${Math.min(2, barW / 2)}"/>`
			base += v
		}
	})

	const avg = days.map((_, i) => {
		const window = days.slice(Math.max(0, i - 6), i + 1)
		return window.reduce((s, d) => s + d.cost, 0) / window.length
	})
	body += `<polyline class="avg" points="${avg.map((v, i) => `${left + i * band + band / 2},${y(v)}`).join(' ')}"/>`

	const ticks = Math.min(days.length, Math.max(2, Math.floor((right - left) / 70)))
	for (let t = 0; t < ticks; t++) {
		const i = Math.round((t * (days.length - 1)) / Math.max(1, ticks - 1))
		body += `<text class="muted" x="${left + i * band + band / 2}" y="${height - 6}" text-anchor="middle">${monthDay(days[i].date)}</text>`
	}

	days.forEach((d, i) => {
		const lines = [`${monthDay(d.date)}: ${money(d.cost)} (7-day avg ${money(avg[i])})`]
		for (const m of used) if ((d.byModel[m] ?? 0) > 0) lines.push(`${shortModel(m)}: ${money(d.byModel[m])}`)
		body += `<rect class="hit" x="${left + i * band}" y="${top}" width="${band}" height="${bottom - top}"><title>${esc(lines.join('\n'))}</title></rect>`
	})

	return svg(width, height, body)
}

export type MonthUsage = { month: string; cost: number; byModel: Record<string, number> }

export function monthlyTotals(days: DayUsage[]): MonthUsage[] {
	const months = new Map<string, MonthUsage>()
	for (const d of days) {
		const key = d.date.slice(0, 7)
		const m = months.get(key) ?? { month: key, cost: 0, byModel: {} }
		m.cost += d.cost
		for (const [model, cost] of Object.entries(d.byModel)) m.byModel[model] = (m.byModel[model] ?? 0) + cost
		months.set(key, m)
	}
	return [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
}

const monthName = (key: string) => parseDate(`${key}-01`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })

/** Stacked monthly bars; the current month also gets a dashed outline at its pace-projected month-end total. */
export function monthlyChart(months: MonthUsage[], models: string[], now: Date, width: number): string {
	const used = models.filter(m => months.some(mo => (mo.byModel[m] ?? 0) > 0))
	const key = legend(
		[...modelSwatches(used, models), { label: 'month-end pace', swatch: (x, y) => `<rect class="prev" fill="none" x="${x}" y="${y - 5}" width="10" height="10" rx="2"/>` }],
		48,
		width - 8,
	)
	// The extra headroom keeps the value labels above the tallest bar clear of the legend.
	const height = 230 + key.height
	const [left, right, top, bottom] = [48, width - 8, key.height + 24, height - 24]
	const currentKey = dateKey(now).slice(0, 7)
	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
	const current = months.find(m => m.month === currentKey)
	const projected = current ? (current.cost / now.getDate()) * daysInMonth : 0
	const max = niceMax(Math.max(...months.map(m => m.cost), projected, 0.01))
	const y = (v: number) => bottom - ((bottom - top) * v) / max
	const band = (right - left) / Math.max(1, months.length)
	const barW = Math.min(64, Math.max(4, band * 0.6))
	let body = key.svg + yAxis(max, left, right, top, bottom)

	months.forEach((mo, i) => {
		const x = left + i * band + (band - barW) / 2
		const isCurrent = mo.month === currentKey
		if (isCurrent && projected > mo.cost) {
			body += `<rect x="${x}" y="${y(projected)}" width="${barW}" height="${y(mo.cost) - y(projected)}" rx="4" fill="none" class="prev"/>`
			body += `<text class="muted" x="${x + barW / 2}" y="${y(projected) - 6}" text-anchor="middle">~${money(projected)} pace</text>`
		}
		let base = 0
		for (const m of used) {
			const v = mo.byModel[m] ?? 0
			if (v <= 0) continue
			const y0 = y(base)
			const y1 = y(base + v)
			const gap = base > 0 && y0 - y1 > 3 ? 2 : 0
			body += `<rect class="s${slot(models, m)}" x="${x}" y="${y1}" width="${barW}" height="${Math.max(0.5, y0 - y1 - gap)}" rx="2"/>`
			base += v
		}
		if (!(isCurrent && projected > mo.cost)) {
			body += `<text class="ink" x="${x + barW / 2}" y="${y(mo.cost) - 6}" text-anchor="middle">${money(mo.cost)}</text>`
		}
		body += `<text class="muted" x="${x + barW / 2}" y="${height - 6}" text-anchor="middle">${monthName(mo.month)}</text>`

		const lines = [`${monthName(mo.month)}: ${money(mo.cost)}${isCurrent ? ` so far (~${money(projected)} at this pace)` : ''}`]
		for (const m of used) if ((mo.byModel[m] ?? 0) > 0) lines.push(`${shortModel(m)}: ${money(mo.byModel[m])}`)
		body += `<rect class="hit" x="${left + i * band}" y="${top}" width="${band}" height="${bottom - top}"><title>${esc(lines.join('\n'))}</title></rect>`
	})

	return svg(width, height, body)
}

export function cumulativeChart(days: DayUsage[], now: Date, width: number): string {
	const height = 200
	const [left, right, top, bottom] = [48, width - 90, 24, height - 24]
	const byDate = new Map(days.map(d => [d.date, d.cost]))
	const series = (year: number, month: number, lastDay: number) => {
		const out: number[] = []
		let sum = 0
		for (let day = 1; day <= lastDay; day++) {
			sum += byDate.get(dateKey(new Date(year, month, day))) ?? 0
			out.push(sum)
		}
		return out
	}
	const thisMonth = series(now.getFullYear(), now.getMonth(), now.getDate())
	const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
	const prevDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
	const lastMonth = series(prevDate.getFullYear(), prevDate.getMonth(), prevDays)
	const max = niceMax(Math.max(...thisMonth, ...lastMonth, 0.01))
	const x = (day: number) => left + ((right - left) * (day - 1)) / 30
	const y = (v: number) => bottom - ((bottom - top) * v) / max
	let body = yAxis(max, left, right, top, bottom)
	for (const day of [1, 8, 15, 22, 29]) {
		body += `<text class="muted" x="${x(day)}" y="${height - 6}" text-anchor="middle">day ${day}</text>`
	}

	const line = (values: number[], cls: string) => `<polyline class="${cls}" fill="none" stroke-width="2" points="${values.map((v, i) => `${x(i + 1)},${y(v)}`).join(' ')}"/>`
	const prevName = prevDate.toLocaleDateString('en-US', { month: 'short' })
	const thisName = now.toLocaleDateString('en-US', { month: 'short' })
	body += line(lastMonth, 'prev')
	body += line(thisMonth, 'l0')
	const endLabel = (values: number[], name: string) =>
		values.length ? `<text class="ink" x="${x(values.length) + 6}" y="${y(values[values.length - 1]) + 4}">${name} ${money(values[values.length - 1])}</text>` : ''
	body += endLabel(lastMonth, prevName)
	body += endLabel(thisMonth, thisName)
	if (thisMonth.length) {
		body += `<circle class="s0" cx="${x(thisMonth.length)}" cy="${y(thisMonth[thisMonth.length - 1])}" r="4"/>`
	}

	for (let day = 1; day <= 31; day++) {
		const parts = [`Day ${day}`]
		if (day <= thisMonth.length) parts.push(`${thisName}: ${money(thisMonth[day - 1])}`)
		if (day <= lastMonth.length) parts.push(`${prevName}: ${money(lastMonth[day - 1])}`)
		if (parts.length === 1) continue
		const w = (right - left) / 30
		body += `<rect class="hit" x="${x(day) - w / 2}" y="${top}" width="${w}" height="${bottom - top}"><title>${esc(parts.join('\n'))}</title></rect>`
	}

	return svg(width, height, body)
}

/** Spreads each 5-hour block's cost evenly across the local hours it was active in. */
export function hourlyGrid(blocks: BlockSpan[], from: Date): number[][] {
	const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
	for (const b of blocks) {
		const start = Date.parse(b.start)
		const end = Math.max(start + 1, Date.parse(b.end))
		if (end < from.getTime()) continue
		const hours: Date[] = []
		for (let t = start; t < end; t += 3_600_000) hours.push(new Date(t))
		for (const h of hours) {
			const weekday = (h.getDay() + 6) % 7
			grid[weekday][h.getHours()] += b.cost / hours.length
		}
	}
	return grid
}

export function heatmapChart(grid: number[][], width: number): string {
	const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
	const left = 36
	const cell = Math.max(8, Math.min(26, (width - left - 8) / 24))
	const height = 7 * cell + 40
	const max = Math.max(...grid.flat(), 0.01)
	let body = ''
	grid.forEach((row, r) => {
		body += `<text class="muted" x="${left - 6}" y="${r * cell + cell / 2 + 4}" text-anchor="end">${days[r]}</text>`
		row.forEach((v, c) => {
			const step = v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999))
			body += `<rect class="h${step}" x="${left + c * cell + 1}" y="${r * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="2"><title>${days[r]} ${String(c).padStart(2, '0')}:00 · ${money(v)}</title></rect>`
		})
	})
	for (const hour of [0, 6, 12, 18]) {
		body += `<text class="muted" x="${left + hour * cell + cell / 2}" y="${7 * cell + 14}" text-anchor="middle">${String(hour).padStart(2, '0')}:00</text>`
	}
	const ly = 7 * cell + 30
	body += `<text class="muted" x="${left}" y="${ly + 4}">less</text>`
	for (let s = 1; s <= 7; s++) body += `<rect class="h${s}" x="${left + 26 + (s - 1) * 14}" y="${ly - 5}" width="12" height="10" rx="2"/>`
	body += `<text class="muted" x="${left + 26 + 7 * 14 + 4}" y="${ly + 4}">more</text>`
	return svg(width, height, body)
}

export function modelShareChart(days: DayUsage[], models: string[], width: number): string {
	const totals = models
		.map(m => ({ m, v: days.reduce((s, d) => s + (d.byModel[m] ?? 0), 0) }))
		.filter(t => t.v > 0)
		.sort((a, b) => b.v - a.v)
	const sum = totals.reduce((s, t) => s + t.v, 0) || 1
	const left = 90
	const right = width - 90
	const rowH = 22
	const height = Math.max(1, totals.length) * rowH + 6
	let body = ''
	totals.forEach((t, i) => {
		const y = i * rowH + 4
		const w = Math.max(2, ((right - left) * t.v) / totals[0].v)
		body += `<text class="ink" x="${left - 8}" y="${y + 12}" text-anchor="end">${esc(shortModel(t.m))}</text>`
		body += `<rect class="s${slot(models, t.m)}" x="${left}" y="${y + 2}" width="${w}" height="14" rx="2"><title>${esc(shortModel(t.m))}: ${money(t.v)}</title></rect>`
		body += `<text class="muted" x="${left + w + 6}" y="${y + 12}">${money(t.v)} · ${Math.round((100 * t.v) / sum)}%</text>`
	})
	return svg(width, height, body)
}

const SPARK = '▁▂▃▄▅▆▇█'
export function sparkline(values: number[]): string {
	const max = Math.max(...values, 0.01)
	return values.map(v => (v <= 0 ? ' ' : SPARK[Math.min(7, Math.floor((v / max) * 7.999))])).join('')
}
