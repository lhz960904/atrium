# Changelog

## [0.7.0](https://github.com/lhz960904/atrium/compare/v0.6.0...v0.7.0) (2026-07-05)


### Features

* **model:** add threads.setModel to bind a model per thread ([153d9b6](https://github.com/lhz960904/atrium/commit/153d9b630dcb8e6c3ca7ddf2c249f71419a86c06))
* **model:** per-thread model with a global default ([90d2d47](https://github.com/lhz960904/atrium/commit/90d2d4761ad696c82e0e2d75251c693c4752406f))


### Bug Fixes

* **model:** keep a thread's saved model across reload ([383eced](https://github.com/lhz960904/atrium/commit/383ecedcdafc6874b7dabbeca9e275e0b21738ba))

## [0.6.0](https://github.com/lhz960904/atrium/compare/v0.5.0...v0.6.0) (2026-07-05)


### Features

* **appearance:** configurable Shiki code theme with preview ([56b813d](https://github.com/lhz960904/atrium/commit/56b813defc87a23afb3e2b10a611e52f2d1eeb9d))
* **settings:** add UI font and global font size to appearance ([244603b](https://github.com/lhz960904/atrium/commit/244603b377cef74c907c25040173caede4a41c05))

## [0.5.0](https://github.com/lhz960904/atrium/compare/v0.4.2...v0.5.0) (2026-07-04)


### Features

* **agent:** cite web sources as markdown links ([7824f70](https://github.com/lhz960904/atrium/commit/7824f704e762444f9eacda783d7de5ac9309a204))
* **chat:** render links as favicon + title chips ([06fa4ef](https://github.com/lhz960904/atrium/commit/06fa4efa5b0ef77184fb0f70adfd2123f4018d7e))


### Bug Fixes

* **agent:** seal dangling tool calls so an interrupted turn can't wedge the thread ([#41](https://github.com/lhz960904/atrium/issues/41)) ([438e091](https://github.com/lhz960904/atrium/commit/438e0917541bc5a9715c0d33960fe70fe1db632a))
* **scheduled:** rotate to a fresh thread when the bound one is archived or gone ([#39](https://github.com/lhz960904/atrium/issues/39)) ([52ce58a](https://github.com/lhz960904/atrium/commit/52ce58aefedbbb3ae493a5292ca51e17a59649e0))
* **scheduled:** settle runs orphaned at running on startup ([#38](https://github.com/lhz960904/atrium/issues/38)) ([6e7f766](https://github.com/lhz960904/atrium/commit/6e7f76631aee488c86e8cfe55becdab79921c4c7))
* **tools:** make web_search honor the abort signal so stop is immediate ([#40](https://github.com/lhz960904/atrium/issues/40)) ([ba0e1f3](https://github.com/lhz960904/atrium/commit/ba0e1f3508cc297484bce2934f430b5302955e88))

## [0.4.2](https://github.com/lhz960904/atrium/compare/v0.4.1...v0.4.2) (2026-07-03)


### Bug Fixes

* scheduled clock badge, running-run spinner, and absolute run time ([#35](https://github.com/lhz960904/atrium/issues/35)) ([14b9ad2](https://github.com/lhz960904/atrium/commit/14b9ad22d413b6d404e9148e3b429336d5b12d84))

## [0.4.1](https://github.com/lhz960904/atrium/compare/v0.4.0...v0.4.1) (2026-07-03)


### Bug Fixes

* **updater:** relaunch on install + clean release-notes rendering ([#32](https://github.com/lhz960904/atrium/issues/32)) ([7dd56cf](https://github.com/lhz960904/atrium/commit/7dd56cfe260f1260584dd33eb6aea4864d3b0ddd))

## [0.4.0](https://github.com/lhz960904/atrium/compare/v0.3.0...v0.4.0) (2026-07-03)


### Features

* **updater:** background auto-download, hourly polling, and the About page ([#30](https://github.com/lhz960904/atrium/issues/30)) ([faeb8e2](https://github.com/lhz960904/atrium/commit/faeb8e282960385f0d00f14b33fe32eafd319ed3))

## [0.3.0](https://github.com/lhz960904/atrium/compare/v0.2.1...v0.3.0) (2026-07-03)


### Features

* **updater:** in-app auto-update via electron-updater ([#28](https://github.com/lhz960904/atrium/issues/28)) ([9e670a6](https://github.com/lhz960904/atrium/commit/9e670a6262122df71c263c071eefd0fc90084543))

## [0.2.1](https://github.com/lhz960904/atrium/compare/v0.2.0...v0.2.1) (2026-07-02)


### Bug Fixes

* **release:** upload installers to the published github release ([d0dbca0](https://github.com/lhz960904/atrium/commit/d0dbca062e86d8bf664140e2e617633b50fc57e9))

## [0.2.0](https://github.com/lhz960904/atrium/compare/v0.1.0...v0.2.0) (2026-07-02)


### Features

* **chat:** collapse long user messages behind a show-more toggle ([#24](https://github.com/lhz960904/atrium/issues/24)) ([f97fcc2](https://github.com/lhz960904/atrium/commit/f97fcc220772ab8fb2fbfdc4dc52e78ce99cfe3d))
* **chat:** edit and re-run a user message ([#26](https://github.com/lhz960904/atrium/issues/26)) ([1f96066](https://github.com/lhz960904/atrium/commit/1f96066c42d2ddbb075794c9b7db3fb839caef7b))
* **composer:** paste images and files as attachments ([#25](https://github.com/lhz960904/atrium/issues/25)) ([f591b5e](https://github.com/lhz960904/atrium/commit/f591b5ea6482db69456819cb66fd5dca3d40a5ea))
* **scheduled:** scheduled tasks (cron automations) ([#22](https://github.com/lhz960904/atrium/issues/22)) ([2214c1b](https://github.com/lhz960904/atrium/commit/2214c1baaebbf84366cc487416113b41675eb01f))


### Bug Fixes

* **providers:** return null when stored credentials can't be decrypted ([692530e](https://github.com/lhz960904/atrium/commit/692530ec346a818e4cf6919df6f1e80b0eab28b4))


### Performance Improvements

* **startup:** move login-shell env and skill scan off first paint ([#23](https://github.com/lhz960904/atrium/issues/23)) ([75a87f9](https://github.com/lhz960904/atrium/commit/75a87f9f5637117cf331483d59858527162703a2))

## [0.1.0](https://github.com/lhz960904/atrium/compare/v0.0.13...v0.1.0) (2026-07-01)

First publicly distributable release: macOS builds are now signed with a Developer ID certificate and notarized by Apple, so they open without Gatekeeper warnings on both Apple Silicon and Intel.

### Bug Fixes

* **ci:** build macOS on macos-15 and macos-15-intel runners ([2b4e58b](https://github.com/lhz960904/atrium/commit/2b4e58be9878cb1aaaa102823e61469f68d0e06e))

## [0.0.13](https://github.com/lhz960904/atrium/compare/v0.0.12...v0.0.13) (2026-07-01)

### Features

* **agent:** anchor today via a per-turn reminder on the latest user turn ([0cf9064](https://github.com/lhz960904/atrium/commit/0cf906442860875606b3c4c2c1d6a299e4efcdfb))
* **composer:** accept slash-menu item with tab ([fc21701](https://github.com/lhz960904/atrium/commit/fc21701be45656e205d000a8517b78f489bcaea0))

### Bug Fixes

* **chat:** contain mermaid errors and limit zoom to pinch ([bc89ff4](https://github.com/lhz960904/atrium/commit/bc89ff403e2b98f148fe4c70f75e45ee8ba3f29f))
* **chat:** keep a manually stopped thread from showing the unread dot ([c9a21df](https://github.com/lhz960904/atrium/commit/c9a21dffc8101f4464f73b8e9e3fa924fe894c41))
* **chat:** smooth streamed markdown rendering ([530b424](https://github.com/lhz960904/atrium/commit/530b4249e1953ae6b80d0a18875fdab7781ce8ea))

## [0.0.12](https://github.com/lhz960904/atrium/compare/v0.0.11...v0.0.12) (2026-06-28)

### Features

* **mcp:** MCP client/host module (stdio + HTTP/OAuth, approvals, reconnect, settings UI) ([ca62958](https://github.com/lhz960904/atrium/commit/ca6295828f4914d49f1041f81abd6a9567e1879c))
* **onboarding:** open the get-acquainted chat in the UI language ([802cf5e](https://github.com/lhz960904/atrium/commit/802cf5ee390045e0ab707858adcdc3516a931232))

### Bug Fixes

* **memory:** tolerate a missing scope dir when writing memory state ([4d8bb80](https://github.com/lhz960904/atrium/commit/4d8bb80d21f0c064fea6697e4378008ae9a965d0))
* **sidebar:** keep collapse/expand animated by memoizing the sidebar ([e5848c9](https://github.com/lhz960904/atrium/commit/e5848c9ef99feb670d29ed246f05d537d3330ce1))

## [0.0.11](https://github.com/lhz960904/atrium/compare/v0.0.10...v0.0.11) (2026-06-27)

### Features

* **keyboard:** configurable shortcuts with a command registry + recorder panel ([78496ab](https://github.com/lhz960904/atrium/commit/78496ab6c47694836cbc0d137127f7d634a6a13f))
* **menu-bar:** add macOS menu-bar tray with New Chat / Open / Quit ([48c29f9](https://github.com/lhz960904/atrium/commit/48c29f9846048730929c90783e2e911e38adc011))
* **menu-bar:** load pre-baked template PNG for the tray icon ([1bae887](https://github.com/lhz960904/atrium/commit/1bae887b8d5f10b25d19dc4e58b6050798777a83))
* **settings:** add Composer group — send keybinding + hide token usage ([5ac5987](https://github.com/lhz960904/atrium/commit/5ac59875c4c5337ad30ed910767dfe8ade22b128))
* **settings:** build out the General panel; fix patch wiping sibling fields ([b904ed6](https://github.com/lhz960904/atrium/commit/b904ed6e22c2ead5293560a08959bb59ac94f54a))
* **settings:** pin section header, unify padding across sections ([6d766ef](https://github.com/lhz960904/atrium/commit/6d766ef8059581fc61ca1c6b406887e87a1c2b0f))
* **ui:** tint scrollbars via standard scrollbar-color, keep auto-hide ([bc4ebda](https://github.com/lhz960904/atrium/commit/bc4ebda0fbe2f18c7e993f0bd1a65454c4b5be3d))

### Bug Fixes

* **window:** hide on close instead of destroy on macOS ([9946c0c](https://github.com/lhz960904/atrium/commit/9946c0c867e59e85019a40adc573d53fd0184d27))
* **window:** leave fullscreen before hide-on-close to avoid blackout ([d44cd62](https://github.com/lhz960904/atrium/commit/d44cd62fc09c1e3011b61ebcf6c82644eb57a429))

## [0.0.10](https://github.com/lhz960904/atrium/compare/v0.0.9...v0.0.10) (2026-06-26)

### Features

* **agent:** rewrite the system prompt around a durable static scaffold ([#8](https://github.com/lhz960904/atrium/issues/8)) ([ab14e4a](https://github.com/lhz960904/atrium/commit/ab14e4acc5d97a91ad4dfdc1f8e5359ef0984782))
* **token-usage:** per-message tokens + context/cost counter ([82877cf](https://github.com/lhz960904/atrium/commit/82877cffed8c986efb9262e4464ab91059e415da))
* **usage:** tRPC usage aggregation router ([7a2437f](https://github.com/lhz960904/atrium/commit/7a2437fcd0aad3f688c4fb159d657e8f3d957124))
* **usage:** usage & billing page in settings ([4bbdae1](https://github.com/lhz960904/atrium/commit/4bbdae114e73d7a64f7eefd74722ed5c9d46ae7a))
* **usage:** usage ledger for chat + subagent turns ([fc0a61c](https://github.com/lhz960904/atrium/commit/fc0a61c1630ce37069837830a1cc6dac1bc8cb68))

### Bug Fixes

* **build:** externalize linkedom's optional canvas dep in main ([a53119b](https://github.com/lhz960904/atrium/commit/a53119b3fdfebea4c4afd988fa453e8d1a66fe34))

## [0.0.9](https://github.com/lhz960904/atrium/compare/v0.0.8...v0.0.9) (2026-06-25)

## [0.0.8](https://github.com/lhz960904/atrium/compare/v0.0.7...v0.0.8) (2026-06-24)

### Features

* **app:** set Atrium brand icon for app, installers, and dev dock ([49f0b2d](https://github.com/lhz960904/atrium/commit/49f0b2d963f2c7cdc0f41ff01b952bc81fa77068))
* **ui:** add Atrium logo component ([f7f9fb4](https://github.com/lhz960904/atrium/commit/f7f9fb4aa5e4b5857a9d6cb5c77f4f6282bc178f))

### Bug Fixes

* stop touching the OS keychain on app launch ([#6](https://github.com/lhz960904/atrium/issues/6)) ([fe9daf4](https://github.com/lhz960904/atrium/commit/fe9daf47430a70d42813899557f1f0d2a059c7fd))
* **ui:** satisfy biome a11y lint on logo svgs ([f6c1187](https://github.com/lhz960904/atrium/commit/f6c1187861047c464afd89d0cf3cc222ddb7ddbc))

## [0.0.7](https://github.com/lhz960904/atrium/compare/v0.0.6...v0.0.7) (2026-06-24)

### Features

* **chat:** start new chats in a project ([7618f93](https://github.com/lhz960904/atrium/commit/7618f93d55628d202988d4c89878af58ea4e9eec))
* **db:** add projects table and thread pin flag ([9d686b3](https://github.com/lhz960904/atrium/commit/9d686b35e183a2091057c6ef29ae708dd89e9b4c))
* **dev:** replace PerfHud with React Scan for render profiling ([#5](https://github.com/lhz960904/atrium/issues/5)) ([59fb063](https://github.com/lhz960904/atrium/commit/59fb0632cd87a6c77941872f9b4566759df7941d))
* **projects:** crud and folder picker over trpc ([2662a96](https://github.com/lhz960904/atrium/commit/2662a961db529c2b5e1908153fc99e1931b5a500))
* **sandbox:** open reads, gate out-of-workspace writes by approval ([61e9bd4](https://github.com/lhz960904/atrium/commit/61e9bd44305cb18a45bd357cf55ee37a9f9e8312))
* **settings:** group the nav and drop section subtitles ([#4](https://github.com/lhz960904/atrium/issues/4)) ([ae0eb13](https://github.com/lhz960904/atrium/commit/ae0eb130d1853ab88ffa200430c0454df2db4ca5))
* **sidebar:** group threads by project ([e032900](https://github.com/lhz960904/atrium/commit/e032900d3b85517d00caa5d939be61ac3a665f05))
* **threads:** pin threads ([d7f31f5](https://github.com/lhz960904/atrium/commit/d7f31f5a2de3f48c379463d4eead233c8ccc655a))

### Bug Fixes

* **memory:** keep dashes in project memory names ([e7a84d0](https://github.com/lhz960904/atrium/commit/e7a84d0cf2af3c562eec67463de91c981589f126))

## [0.0.6](https://github.com/lhz960904/atrium/compare/v0.0.5...v0.0.6) (2026-06-22)

### Features

* **chat:** fade streamed tokens in as they arrive ([313c63c](https://github.com/lhz960904/atrium/commit/313c63cfeab9dceacba2fadfddf7fe11cdf296ba))
* **chat:** keep the view stuck to the latest message while streaming ([6d313a3](https://github.com/lhz960904/atrium/commit/6d313a39ac35b5da9b82b09a980c9d31cc5e9931))
* **instructions:** discover layered AGENTS/CLAUDE files ([1105f0a](https://github.com/lhz960904/atrium/commit/1105f0a9117a42fe6c9280353a06293b337a6afb))
* **instructions:** inject discovered instructions into the first user message ([5aa53d3](https://github.com/lhz960904/atrium/commit/5aa53d3ab18bbf72eb4d97083eaf19a947d387e5))
* **instructions:** wire instructions middleware into the agent loop ([cd748de](https://github.com/lhz960904/atrium/commit/cd748de59944d213fd3e04f52602bdfc4ba2dadd))
* **memory:** add the dream consolidation agent and wire the scheduler ([e086d98](https://github.com/lhz960904/atrium/commit/e086d982e014cc513b3fa412288fc96177e81887))
* **memory:** add the dream consolidation gate, lock, and scheduler ([8e02638](https://github.com/lhz960904/atrium/commit/8e02638f1773fca69efeb3c481399bece0b446a8))
* **memory:** add the memory tool with per-scope file storage ([05d89d1](https://github.com/lhz960904/atrium/commit/05d89d119893c560d513bedd65f8ed1798227e65))
* **memory:** address memory by scope key for multi-project browsing ([c8bec4c](https://github.com/lhz960904/atrium/commit/c8bec4c5201a762448665a919010a44de5497fe4))
* **memory:** inject the memory index and count sessions per turn ([722ec10](https://github.com/lhz960904/atrium/commit/722ec103b919293e52fde2891d16f35b11c4d9b0))
* **memory:** list and delete stored topics over trpc ([6f233ae](https://github.com/lhz960904/atrium/commit/6f233ae43c817b815b7e2538d6ba21bdb24170e4))
* **profile:** add the profile tool and get-acquainted skill ([a08faf7](https://github.com/lhz960904/atrium/commit/a08faf79d47ad58ba5a40df724397debaee58884))
* **profile:** inject SOUL/USER and greet the user by name ([3a9b5f9](https://github.com/lhz960904/atrium/commit/3a9b5f9f0579ef8189c0d32f4b87bab86a838041))
* **profile:** offer onboarding from home; return (empty) on a blank profile ([41459f0](https://github.com/lhz960904/atrium/commit/41459f06284a72d387af1495bc008777283a6adf))
* **profile:** read and write identity files over trpc ([46992b0](https://github.com/lhz960904/atrium/commit/46992b0332bce52c3d62d29ab9249aed38e85a63))
* rename & archive conversations ([#3](https://github.com/lhz960904/atrium/issues/3)) ([d25528a](https://github.com/lhz960904/atrium/commit/d25528ae6e85e046379f37f8f450a58b9b2ccc05))
* **settings:** add identity and memories sections ([0c987e1](https://github.com/lhz960904/atrium/commit/0c987e1b7af834a80696c04a1296f2f8eaae824f))

### Bug Fixes

* **chat:** keep the assistant side non-blank while a turn spins up ([29031a3](https://github.com/lhz960904/atrium/commit/29031a327ed499992d764ebef45e65bb846a4609))
* **chat:** load the stress-repro fixture via glob so CI builds without it ([5f5e276](https://github.com/lhz960904/atrium/commit/5f5e276421d49231406646f6262b3539c605eade))
* **layout:** slide sidebar toggle in lockstep with collapse ([51416cf](https://github.com/lhz960904/atrium/commit/51416cf3fff88d96a714d2a461e366214fac7d46))
* **tools:** cancel in-flight bash and web-fetch on user stop ([c85244d](https://github.com/lhz960904/atrium/commit/c85244d5e6e8a609bd5137f8755323284a5a47f7))
* **tools:** kill the whole process tree, not just the shell ([#2](https://github.com/lhz960904/atrium/issues/2)) ([1f3ac4d](https://github.com/lhz960904/atrium/commit/1f3ac4d518d18b96ef0614214513a3097326f4af))

### Performance Improvements

* **chat:** avoid full-thread re-render on every streaming chunk ([5f04e09](https://github.com/lhz960904/atrium/commit/5f04e0943d581a4fa290139e5bb6a89633dafa78))

## [0.0.5](https://github.com/lhz960904/atrium/compare/v0.0.4...v0.0.5) (2026-06-14)

### Features

* **acp:** route external agent permission asks through the approval card ([21d1e79](https://github.com/lhz960904/atrium/commit/21d1e796b02c0ebfc71ec43e3c0941d72853524b))
* **chat:** generate a thread title from the first message ([52f385d](https://github.com/lhz960904/atrium/commit/52f385ddae1e65fde9cd383315fdc4c4db2ce857))
* **chat:** surface tool-approval requests in an approval card ([a3b11f4](https://github.com/lhz960904/atrium/commit/a3b11f4ec4b55df2164b40614117ad324e1a1755))
* **home:** replace mock home content with live recent chats ([5694c5a](https://github.com/lhz960904/atrium/commit/5694c5a5ea956a853243def54fda31fc9acc2862))
* **i18n:** bilingual UI with a language switcher ([d2fae4a](https://github.com/lhz960904/atrium/commit/d2fae4a52c765f008206d601565c994482ec4dd6))
* **permissions:** add composer permission-mode selector ([934d6a0](https://github.com/lhz960904/atrium/commit/934d6a0fe6b45fba207db6e3dd8ef06a74c21285))
* **permissions:** add workspace-boundary classifier and approval decision ([ff232cb](https://github.com/lhz960904/atrium/commit/ff232cb6fe7645bb4bb4d2d3fd6e79294db86b75))
* **permissions:** always-allow, persisted mode picker, Settings panel ([5f3b9b5](https://github.com/lhz960904/atrium/commit/5f3b9b552f400ff201b4334e21f16a42f6dc71ae))
* **permissions:** auto-review mode judges boundary crossings with a model ([ec873c4](https://github.com/lhz960904/atrium/commit/ec873c46270d678150ad547cb69cd1503879ebdb))
* **permissions:** configure the auto-review reviewer and surface its approvals ([0383279](https://github.com/lhz960904/atrium/commit/03832798eb8c2357445bd89ded6aecaaf581f3d6))
* **permissions:** gate boundary-crossing tools behind the approval card ([3c0438b](https://github.com/lhz960904/atrium/commit/3c0438bedb2a6dbc041c8baa4c2b26134c46a27a))
* **permissions:** trust list engine and persisted mode (backend) ([8f3ff3f](https://github.com/lhz960904/atrium/commit/8f3ff3fba25f0b4e105c5a9715c72fa6f9450023))
* **providers:** ollama local model service backend ([6e0dc7c](https://github.com/lhz960904/atrium/commit/6e0dc7caa4ca1b5be5604a492c493abebf2f1a72))
* **providers:** ollama model downloads with progress and registry validation ([bc2a227](https://github.com/lhz960904/atrium/commit/bc2a22786389a9ef9ca326ecb9ee01d28ee5747a))
* **providers:** ollama settings form with detection and installed models ([bbe6b75](https://github.com/lhz960904/atrium/commit/bbe6b753256a5f69b9987007e453503838c5ccdc))
* **search:** add ⌘K command palette with chat search ([93e33af](https://github.com/lhz960904/atrium/commit/93e33af51a794b30c9ff33853fe62d1c4c974af3))
* **search:** add full-text chat search backend ([0010dff](https://github.com/lhz960904/atrium/commit/0010dff3fbbed0a41d67d64f87ace59f2219d2ff))
* **sidebar:** collapsible and resizable sidebar ([0778fc0](https://github.com/lhz960904/atrium/commit/0778fc0fcbf069691e1964bb8bb4a301354ab6a1))

### Bug Fixes

* **chat:** don't replay a finished stream on reload ([87de593](https://github.com/lhz960904/atrium/commit/87de5938cc814145af04b7029c110cfdc5e7481d))
* **chat:** emit start chunk in image turns so replays bind to one message ([d8747d4](https://github.com/lhz960904/atrium/commit/d8747d4da0bbe4145019b2db922e834ff3839deb))
* **chat:** render hallucinated tool names instead of crashing ([2322866](https://github.com/lhz960904/atrium/commit/232286610d0bc41b590930f1e7d25051533d954a))
* **permissions:** keep the composer mode in sync across settings and navigation ([57c4583](https://github.com/lhz960904/atrium/commit/57c45836fd0bd09b6eaff5a0966788a07c4c8646))
* **tools:** glob matches directories, not just files ([66c5c17](https://github.com/lhz960904/atrium/commit/66c5c1744c3a531760e728965a49a39f726ce1f8))

## [0.0.4](https://github.com/lhz960904/atrium/compare/v0.0.1...v0.0.4) (2026-06-08)

### Bug Fixes

* **build:** disable mac hardened runtime so ad-hoc build launches ([19a6082](https://github.com/lhz960904/atrium/commit/19a6082a7a1eb1bc0f8b5cd631694a591116c496))
* **renderer:** use hash history so routing works in the packaged app ([f02e08c](https://github.com/lhz960904/atrium/commit/f02e08c6796ddaf9cd8e7bfa33b0a94020029830))

## [0.0.1](https://github.com/lhz960904/atrium/compare/f6f323678775e76144df2f89be42d5f2087365fc...v0.0.1) (2026-06-08)

### Features

* **acp:** add a client-side ACP session for external agents ([234d948](https://github.com/lhz960904/atrium/commit/234d9483a0982c422fca5c50771ed19c43aaa099))
* **acp:** add the external-agent runtime ([05348af](https://github.com/lhz960904/atrium/commit/05348af518127f23d51280e35de240f078fc4c46))
* **acp:** route local-cli providers to external agents ([ced5388](https://github.com/lhz960904/atrium/commit/ced538875e40d21035ad01d56939105f49892bed))
* add scoped logging via electron-log ([208ada3](https://github.com/lhz960904/atrium/commit/208ada34d39e8282ed13b3cbef60ea78f793d97f))
* **agent:** activate compaction and stream its progress ([0a72d72](https://github.com/lhz960904/atrium/commit/0a72d72df8ddfef7911fa910fa7636d1299af715))
* **agent:** add a background shell registry ([b69cc23](https://github.com/lhz960904/atrium/commit/b69cc23539c0d2ad58b6a5ac6b575f16aaeac7f4))
* **agent:** add compaction summarizer ([37dd955](https://github.com/lhz960904/atrium/commit/37dd9551b349028eac815015ff102d69ef892004))
* **agent:** add compaction token counting and window selection ([a8e08b1](https://github.com/lhz960904/atrium/commit/a8e08b1475a6c8d9799500bf4ac32ead91bdeae1))
* **agent:** add grep and glob search backed by fast-glob ([ea36917](https://github.com/lhz960904/atrium/commit/ea3691729196e28f3ad8f57f7decd44c5238b8e3))
* **agent:** add image_gen tool ([4ab1db1](https://github.com/lhz960904/atrium/commit/4ab1db103b9bf639cb5e7a75333014cded52b3a9))
* **agent:** add metadata and persistence middlewares ([936cb66](https://github.com/lhz960904/atrium/commit/936cb661c599f4ecb55ffcfddef402a35b7d46d8))
* **agent:** add middleware interface and folding primitives ([c9d87c9](https://github.com/lhz960904/atrium/commit/c9d87c969c3fa7ab1c869fe9a69a0d6268bc962f))
* **agent:** add nested subagent loop ([6c04e81](https://github.com/lhz960904/atrium/commit/6c04e814968f3ec381236f75a14ac3ef1690c2a0))
* **agent:** add subagent definitions and registry ([ae4e5a0](https://github.com/lhz960904/atrium/commit/ae4e5a0fb8d029ce4bd25713dbe30135b9ef3f91))
* **agent:** compact within a turn when the tool loop balloons ([b4cfbe6](https://github.com/lhz960904/atrium/commit/b4cfbe6921c311f337dea919d341a59e25a25c77))
* **agent:** emit and log cross-turn compaction ([9bb8f0f](https://github.com/lhz960904/atrium/commit/9bb8f0f4c37704c121993f153b8069f7afc913f0))
* **agent:** localhost chat stream backend (text-only) ([15c4838](https://github.com/lhz960904/atrium/commit/15c4838638ca070a607360e8b0ccbc72ea2d156e))
* **agent:** summarize old history near the context limit ([b8b9eaa](https://github.com/lhz960904/atrium/commit/b8b9eaafe5489d947ebd3424de6eb3bd930b0e9e))
* **chat:** add markdown block renderers ([c45a3c4](https://github.com/lhz960904/atrium/commit/c45a3c48682b59be9820f861a50f5ff7e616116d))
* **chat:** attach files to messages and surface turn errors ([5e10e84](https://github.com/lhz960904/atrium/commit/5e10e849e25bd72361df7a78c503eed35306ce67))
* **chat:** cancel a clarification and take back the turn ([b934d18](https://github.com/lhz960904/atrium/commit/b934d18cf8a1467f5f0b3a3245cea190ee75b2ea))
* **chat:** composer model picker ([9ca4711](https://github.com/lhz960904/atrium/commit/9ca471104cfd041e527f9bfc3273e5259f75206f))
* **chat:** copy button on hover for user messages and answers ([47d1e5b](https://github.com/lhz960904/atrium/commit/47d1e5be1a303974f6bffde7df05e92a54d01bdf))
* **chat:** decouple agent runs from the request lifecycle ([fb8fd82](https://github.com/lhz960904/atrium/commit/fb8fd82bdcb40bb3d34f8379784c3ddfbd09f0e3))
* **chat:** end-to-end streaming chat with best-practice persistence ([9c9b857](https://github.com/lhz960904/atrium/commit/9c9b857f61212f89bc2a3bba5af8de2e81a3d5c9))
* **chat:** keep the plan out of the work trace, derive it from messages ([9ef16d6](https://github.com/lhz960904/atrium/commit/9ef16d6bed09279e37e0f9d812bdaa24c85cb4c3))
* **chat:** keep the view pinned to the bottom while streaming ([afa781e](https://github.com/lhz960904/atrium/commit/afa781ed82207433cd3515d3b33de7c836b6f6e3))
* **chat:** preview attachments and refine the attachment row ([f44aa4b](https://github.com/lhz960904/atrium/commit/f44aa4baccb1779df01e06851f917636cbb4b1e5))
* **chat:** reconnect on mount, persistent chat, sidebar run/unread indicators ([00c92c8](https://github.com/lhz960904/atrium/commit/00c92c860760016f70ba5d1893ecf2ff0042c137))
* **chat:** render assistant replies as markdown via streamdown ([e674361](https://github.com/lhz960904/atrium/commit/e674361cd7f881cf7f92ed7045f6434df0d0fc79))
* **chat:** render external-agent tool calls ([9b6be83](https://github.com/lhz960904/atrium/commit/9b6be8380d2e158fd0395df19a99f3bf52fb24d6))
* **chat:** render generated images inline ([da6b549](https://github.com/lhz960904/atrium/commit/da6b5499aba1d6ea8dd4a8c81df02963ca18f4bf))
* **chat:** render skill mentions as chips in the bubble ([0831e65](https://github.com/lhz960904/atrium/commit/0831e65fc4c9933713bb4f8a3ae30855749112aa))
* **chat:** render turns as Thought / Worked trace ([fb7741e](https://github.com/lhz960904/atrium/commit/fb7741e38802ab6546645fe912872a40df164e7e))
* **chat:** resumable streams and server-side run/read state ([efb8736](https://github.com/lhz960904/atrium/commit/efb8736a5fe33a4d9e25050bcfaed4951d42883c))
* **chat:** route image-model turns to image generation ([30687cd](https://github.com/lhz960904/atrium/commit/30687cdd76de5bc8c7504df76f18c260dc02f03b))
* **chat:** select external CLI agents from the model picker ([d769d3e](https://github.com/lhz960904/atrium/commit/d769d3ec3e16a80d39aaf712c683ed988ae8bdd4))
* **chat:** show a Working loading state before the first token ([de9b875](https://github.com/lhz960904/atrium/commit/de9b875e4da183c4d9982801fe93dd4cae3fe0b2))
* **chat:** show present-tense tool labels while a call runs ([5edc18b](https://github.com/lhz960904/atrium/commit/5edc18b211c3a703b0f14ca95247737b638e3b57))
* **chat:** show the plan in a panel above the composer ([6c376d5](https://github.com/lhz960904/atrium/commit/6c376d5d231e1c9c682b5a364291be46ee8175f8))
* **chat:** stamp duration on external-agent turns ([3f350d5](https://github.com/lhz960904/atrium/commit/3f350d5cce1702aca85ba0bc237a5f5409134bea))
* **chat:** stamp timing onto assistant messages ([4d97548](https://github.com/lhz960904/atrium/commit/4d97548176c6a6fff743e4147e493b4dd0c0278f))
* **chat:** stop in-flight generation ([dcc8854](https://github.com/lhz960904/atrium/commit/dcc8854767abf04f11079eb9a8918ea75a95cf4a))
* **chat:** stream subagent activity into its task card ([9277ec0](https://github.com/lhz960904/atrium/commit/9277ec0fc6faa94d299d0dba4a31490d94e5d165))
* **chat:** surface compaction in the transcript ([ca09e62](https://github.com/lhz960904/atrium/commit/ca09e6281a27ce0fbf584fea735536b50e1b80c9))
* **chat:** wire ask_clarification into the chat UI ([d3ec8c1](https://github.com/lhz960904/atrium/commit/d3ec8c1a0343d608ca6038af0d4bddcf5672b4b7))
* **compaction:** force-compact a thread on demand ([d36fea3](https://github.com/lhz960904/atrium/commit/d36fea30a6e4030a74337b2779fe3e3576401b59))
* **composer:** add slash commands and the Compact command ([84d9cd2](https://github.com/lhz960904/atrium/commit/84d9cd2cf1b1e5caf1b105fcdf8fa2a7120f6d41))
* **composer:** replace the textarea with a Tiptap editor ([283de69](https://github.com/lhz960904/atrium/commit/283de690d903498755339976a5b82769ef0d7a06))
* **composer:** slash menu and skill chips via Tiptap suggestion ([01506fe](https://github.com/lhz960904/atrium/commit/01506fe960e14d921de951d789d6eecf814e2b38))
* **data:** wire chat data layer to sqlite via trpc ([c23df2e](https://github.com/lhz960904/atrium/commit/c23df2ef430b7c1d4ecbb9715c6a7105f4072f34))
* **models:** detect and resolve image-generation models ([ce56607](https://github.com/lhz960904/atrium/commit/ce566071d42e5ba7c715c48ebb46997b585d8f87))
* **models:** source model metadata from models.dev with offline fallback ([9a6c0bf](https://github.com/lhz960904/atrium/commit/9a6c0bf65c2458e0e816f9256d79f7c7e422f51f))
* **models:** surface output modalities in capabilities ([8888e1f](https://github.com/lhz960904/atrium/commit/8888e1f29d3c16a332b3235cad3ded65fc1dfbe4))
* **providers:** add providers table + static manifest ([84e99c7](https://github.com/lhz960904/atrium/commit/84e99c72ebaa687b898ec952ced8c4355d1ee0cd))
* **providers:** brand icons + detail form skeleton with autosave ([ab1595e](https://github.com/lhz960904/atrium/commit/ab1595e94903ead0a258c6eba098836156f0794f))
* **providers:** configurable ACP command and arguments ([30c62a0](https://github.com/lhz960904/atrium/commit/30c62a03cfa0e51d0ea5fdd11d380bbd5417c025))
* **providers:** fetch models + per-model enable toggle ([e6a1da3](https://github.com/lhz960904/atrium/commit/e6a1da33af6a4ed60ecf8e4414cc69eaecdd58ed))
* **providers:** list enabled image-output models ([4cf9192](https://github.com/lhz960904/atrium/commit/4cf91922fe71efff3b9f5d3713bd7f1eac3ad2a0))
* **providers:** tRPC router with safeStorage credential encryption ([31a0da2](https://github.com/lhz960904/atrium/commit/31a0da2fdba38cbf1ed9075e9a2bd68046d1042f))
* **settings:** add electron-conf settings store + tRPC router ([235ec74](https://github.com/lhz960904/atrium/commit/235ec74f2e155b75d0ec19fb7cdb5fc0e1622f82))
* **settings:** persist window size + maximize + fullscreen via electron-conf ([a31656a](https://github.com/lhz960904/atrium/commit/a31656a887ce85ec28d5e77d1dc5baa2cfc32273))
* **skills:** discover at startup and wire into the agent loop ([62c01ab](https://github.com/lhz960904/atrium/commit/62c01ab8c80c7136b895725ba34307192138b912))
* **skills:** discover skills across ecosystem directories ([87573ea](https://github.com/lhz960904/atrium/commit/87573ea0c3b8e76b524ef8d83eec50995c88e69d))
* **skills:** expose discovered skills over tRPC ([63443d1](https://github.com/lhz960904/atrium/commit/63443d1a810e1c5a80f1c540f4dfa0713e4b2184))
* **skills:** inject the available-skills index into the first turn ([8152977](https://github.com/lhz960904/atrium/commit/8152977db781375f61ea2d4a7e189bdf1c4a6460))
* **skills:** load skills on demand and scope tools on activation ([c917308](https://github.com/lhz960904/atrium/commit/c917308dc6206ca7418bbec7c0156da16ffb80ec))
* **skills:** read-only skills list in settings ([71ee407](https://github.com/lhz960904/atrium/commit/71ee407ce65fef1b86febd72908832eaec161c3d))
* **skills:** rescue the active skill body across compaction ([df3c406](https://github.com/lhz960904/atrium/commit/df3c40643d559c77fa94c817ce06ae32f318f13f))
* **skills:** surface skills in the slash menu and invoke them ([bd9352e](https://github.com/lhz960904/atrium/commit/bd9352e639855e12530fda9362b8d080aa325398))
* **subagents:** CRUD over tRPC for custom subagents ([902c4a9](https://github.com/lhz960904/atrium/commit/902c4a922d8477d408250296c5116790142ce11e))
* **subagents:** settings panel to manage custom subagents ([eb4c9db](https://github.com/lhz960904/atrium/commit/eb4c9db1532ef9e0d584491a7d33157b9176bf2f))
* **tools:** add edit_file tool ([d26ed2a](https://github.com/lhz960904/atrium/commit/d26ed2ad42f36b07ea0b28d4603a48fe01ea4094))
* **tools:** add grep and glob search tools ([5a86c58](https://github.com/lhz960904/atrium/commit/5a86c584dd49d9e90d53c0789da102c9d91a9e82))
* **tools:** add task tool for delegating to subagents ([10d6bd0](https://github.com/lhz960904/atrium/commit/10d6bd0cae2c266c01a48ae072d587acd5708df6))
* **tools:** add the ask_clarification tool ([c1ede76](https://github.com/lhz960904/atrium/commit/c1ede768be3e95dce7e606549f22b7536ce3fe67))
* **tools:** add todo_write plan tool ([a2ed297](https://github.com/lhz960904/atrium/commit/a2ed297cc9cf3aaf7ac4d628c12f6df559b45fb9))
* **tools:** add web_fetch ([ce265a0](https://github.com/lhz960904/atrium/commit/ce265a0609ac75b2a1bb47411c2ec12dd2cd4af5))
* **tools:** add web_search via headless DuckDuckGo ([4c79d19](https://github.com/lhz960904/atrium/commit/4c79d1923dc0b71e86c612f2d460efae748870d2))
* **tools:** wire edit_file into the agent ([00f6fc7](https://github.com/lhz960904/atrium/commit/00f6fc7ce413e561c11158566f8c317e1901a543))
* **ui:** add a toast primitive on Radix Toast ([1277f06](https://github.com/lhz960904/atrium/commit/1277f06d2187bb83bf454f6f06d07a94d5eb1351))
* **ui:** chat route + ergonomic fixes + componentize chat renderers ([7f16102](https://github.com/lhz960904/atrium/commit/7f16102b02849adcdf5af476af5713c8067d39cf)), closes [#0F0F12](https://github.com/lhz960904/atrium/issues/0F0F12) [#16161B](https://github.com/lhz960904/atrium/issues/16161B)
* **ui:** clarify card supports multi-question with tab switching ([67e1f17](https://github.com/lhz960904/atrium/commit/67e1f179cc90acc2ba72fafd03f539e8bf797340))
* **ui:** codex-style trace + interleaved narrative + tool-expand readability ([92d24db](https://github.com/lhz960904/atrium/commit/92d24db779fa595101b668623b70f40d67bfe8cd))
* **ui:** empty state — project chip + greeting + composer + continue list ([1f4220a](https://github.com/lhz960904/atrium/commit/1f4220a1a18089d759434db638544ae95fc95328))
* **ui:** full composer + sidebar New chat + composer floats on canvas ([e73280f](https://github.com/lhz960904/atrium/commit/e73280f068b7c4da4ac13c8eed89f9bbad500dc9))
* **ui:** full-width window drag + sidebar selection polish ([f569690](https://github.com/lhz960904/atrium/commit/f5696901ee4d17536503978a622afd3f9e876ae2))
* **ui:** settings nav with lucide icons + active accent ([79336dd](https://github.com/lhz960904/atrium/commit/79336ddcb4d58a84686e1840451f0fe7b4ea8980))
* **ui:** subagent card primitive ([84e3c5d](https://github.com/lhz960904/atrium/commit/84e3c5d8444a9f58286eee234f85e09be79b0797))
* **ui:** TanStack Router scaffold + sidebar + drop shortcuts UI ([f6f3236](https://github.com/lhz960904/atrium/commit/f6f323678775e76144df2f89be42d5f2087365fc))
* **ui:** theme switcher + section stubs ([b8d73fc](https://github.com/lhz960904/atrium/commit/b8d73fcebab9541ed318c4155bfc007b90018d29))
* **welcome:** minimal welcome route + first-launch gating ([61ca7cb](https://github.com/lhz960904/atrium/commit/61ca7cba94aeb5f8511fe89060d58fbbecc01ce6))

### Bug Fixes

* **acp:** cap live sessions with LRU eviction ([dc0ca52](https://github.com/lhz960904/atrium/commit/dc0ca522c3cbc92a7906cb0cff260d82711eb55f))
* **acp:** mark external-agent tools as provider-executed ([05e4332](https://github.com/lhz960904/atrium/commit/05e4332befb71c67ad35aa886fccf2e06c192aa2))
* **acp:** name the provider and install command when the adapter is missing ([02a0c50](https://github.com/lhz960904/atrium/commit/02a0c50eba951572f0f841448856776fa7091d5f))
* **acp:** survive a missing adapter and stop gating on auth methods ([ad50740](https://github.com/lhz960904/atrium/commit/ad507404d41d300fb51fea8d416e1ec61cb1a285))
* **agent:** make compaction fail-safe and preserve feature state across folds ([6303fe3](https://github.com/lhz960904/atrium/commit/6303fe3a0d7bee8b680b4b296b7b383af0e017db))
* **chat:** render streaming narrative as markdown ([de6b31c](https://github.com/lhz960904/atrium/commit/de6b31cad659d0284458e9dffea38806dcb842d8))
* **chat:** surface the unread dot when a background run finishes ([f190647](https://github.com/lhz960904/atrium/commit/f19064788b80c13d4cd9f84830adc333e875f688))
* **server:** persist a resumed turn's continuation ([fb44acc](https://github.com/lhz960904/atrium/commit/fb44accf216c7ae814f07477c0aa989eec087e87))
* **skills:** read only the canonical allowed-tools key and self-own the logger ([7ee3e7f](https://github.com/lhz960904/atrium/commit/7ee3e7f361103c9538df4bf705a6fb547c6850ae))
