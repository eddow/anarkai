import {
	alveoli as alveoliRules,
	configurations as configurationsRules,
	deposits as depositsRules,
	goods as goodsRules,
	jobBalance as jobBalanceRules,
	terrain as terrainRules,
	vehicles as vehiclesRules,
} from 'engine-rules'

/** Authoritative gameplay catalogs live in `engine-rules`; this module re-exports with ssh contract typing. */
export const terrain = terrainRules satisfies Record<string, Ssh.TerrainDefinition>

export const deposits = depositsRules satisfies Record<string, Ssh.DepositDefinition>

export const alveoli = alveoliRules satisfies Record<string, Ssh.AlveolusDefinition>

export const goods = goodsRules satisfies Record<string, Ssh.GoodsDefinition>

export const jobBalance = jobBalanceRules

export const vehicles = vehiclesRules satisfies Record<string, Ssh.VehicleDefinition>

/** Default configurations by action type */
export const configurations = configurationsRules as Record<string, Ssh.AlveolusConfiguration>
