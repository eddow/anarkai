declare module 'webgpgpu.ts' {
	type WebGpGpuScalar = {
		array(length: number | string): unknown
	}

	export const f32: WebGpGpuScalar
	export const u32: WebGpGpuScalar
	export const vec2i: WebGpGpuScalar
	export const vec4f: WebGpGpuScalar

	export default function createWebGpGpu(): Promise<any>
}
