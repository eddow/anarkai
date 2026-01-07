import '@picocss/pico/css/pico.min.css'
import './app.css'
import './lib/hmr-pixi'
import { profileInfo } from 'mutts'
import { bindApp } from 'pounce-ts'
import App from '@app/app/App'
import { initTranslator } from './lib/i18n'

	; (globalThis as typeof globalThis & { ['mutts:profile']?: typeof profileInfo })['mutts:profile'] =
		profileInfo

async function bootstrap() {
	await initTranslator()
	bindApp(<App />, '#app')
}

bootstrap().catch(console.error)

