import '@picocss/pico/css/pico.min.css'
import './app.css'
import { profileInfo } from 'mutts'
import { bindApp, h } from 'pounce-ts'
import App from '@app/App'
import { initTranslator } from 'ssh/src/lib/i18n'
import * as actions from 'pounce-ui/src/actions'

	; (globalThis as typeof globalThis & { ['mutts:profile']?: typeof profileInfo })['mutts:profile'] =
		profileInfo

async function bootstrap() {
	await initTranslator()
	bindApp(<App />, '#app', actions)
}

bootstrap().catch(console.error)

