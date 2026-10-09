export type DayUsage = {
	date: string
	cost: number
	tokens: number
	byModel: Record<string, number>
}

export type BlockSpan = { start: string; end: string; cost: number }

export type ActiveBlock = {
	cost: number
	startTime: string
	endTime: string
	costPerHour: number
	projectedCost: number
	remainingMinutes: number
}

export type UsageHistory = {
	days: DayUsage[]
	blocks: BlockSpan[]
	models: string[]
	updatedAt: number
}

export type UsageRange = '30' | '90' | 'all'

declare module 'claude-code' {
	interface PluginState {
		'usage-panel': {
			history: UsageHistory | null
			active: ActiveBlock | null
			activeUpdatedAt: number
			range: UsageRange
			error: string | null
		}
	}
}
