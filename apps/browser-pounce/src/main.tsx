import '@picocss/pico/css/pico.min.css'
import './app.css'
import { profileInfo } from 'mutts'
import { latch } from '@pounce'
import { options } from '@pounce/ui'
import { mount, tablerOutlineX } from 'pure-glyf/icons'
import App from './App'
import { initTranslator } from 'ssh/i18n'

mount()
options.iconFactory = (name, size, el, context) => {
	void context
	const cls = {
		'tabler-outline-x': tablerOutlineX,
	}[name]
	if (!cls) return <span {...el} data-icon={name}>{name}</span>
	const fontSize = size ? (typeof size === 'number' ? `${size}px` : size) : undefined
	return <span {...el} class={[el.class, cls]} style={fontSize ? { fontSize } : undefined} />
}

latch('#app', <App />)

; (globalThis as typeof globalThis & { ['mutts:profile']?: typeof profileInfo })['mutts:profile'] =
	profileInfo

async function bootstrap() {
	await initTranslator()
}

bootstrap().catch(console.error)
