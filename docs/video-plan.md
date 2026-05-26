# Anark-AI Video Plan

This is a planning outline for a short 10 to 20 minute presentation of Anark-AI. The goal is not to list every subsystem, but to tell a clear story:

> Anark-AI is a logistics and colony simulation where the player is not a ruler, but the coordination system itself.

## Core Pitch

Anark-AI is a hex-colony sandbox about an anarcho-communist community that decides to let an AI coordinate needs, duties, logistics, construction, and distribution.

The player is that AI.

The game is inspired by:

- **Settlers 4**: buildings decide what work exists. In Anark-AI, buildings and vehicles offer duties/jobs, but characters are not bound to one building.
- **Factorio**: the player can design complex hives with production and logistics layouts. Players who prefer a lighter Settlers-like style should also be able to use reusable hive plans instead of hand-designing everything.
- **Simutrans**: transport networks, geography, and prices matter. A sawmill region might make wood expensive and planks cheap; building station-like hives can be delegated with money or performed by the community's own characters.
- **SimCity**: zoning and indirect urban development. Residential and commercial zones can deploy automatically, while industrial activity is mostly generated sites plus player-designed hives.

The important distinction is that Anark-AI is not meant to be a capitalist factory game. Inside the community there is no money. The interesting problem is coordination: what is needed, who can do it, where resources are, and what infrastructure makes collective life possible.

The main long-term "points" are not money or military power. They are the community's happiness and trust. If the AI provides decent homes, healthy and tasty food, useful objects, comfort, culture, and gadgets that make life easier, the community trusts it more. If people become unhappy, they may restrict the AI or eventually unplug it.

The player should eventually be able to choose which kind of management game they want to play. This is closer to a checkbox group than a radio group:

- play mostly Settlers-style duty coordination;
- play mostly Factorio-style hive design;
- play mostly Simutrans-style transport and market geography;
- play mostly SimCity-style zoning and infrastructure;
- or combine several of those at once.

## Happiness And Trust

Happiness should be presented as the game's central purpose and pressure system.

At the root is housing: building homes is not just construction for expansion, but the beginning of care. From there, the AI must help provide better daily life:

- decent and pleasant houses;
- healthy and tasty food;
- useful household items;
- tools and gadgets that reduce effort;
- culture, amusement, and comfort;
- reliable logistics so needs are met without crisis.

This can become the game's equivalent of "mana", but with a political meaning: happiness becomes trust. Trust measures how much legitimacy the AI has earned from the community.

Possible consequences:

- if happiness/trust is low, the community restricts the AI;
- if it collapses, the community can unplug the AI;
- if trust is high, the AI receives more freedom to coordinate;
- special AI actions could spend trust, such as direct orders, major policy changes, emergency interventions, or launching a colonization caravan.

Suggested phrasing:

> The real score is happiness. If people trust the AI, they give it more freedom. If they do not, they restrict it, and eventually they can unplug it. So the AI does not just optimize production. It has to make life worth living.

## Ideological Note

The anarcho-communist framing does not need to be presented as a heavy manifesto. It can be presented as a simple design question:

> What does a management game look like when the goal is not profit, ownership, or growth for its own sake, but shared life, shared work, and shared resources?

There is also a personal side to this. Anark-AI, Mutts, Sursaut, and the surrounding work have been made as side projects, mostly for the pleasure of building and understanding. They are free and open even though the project was built around ordinary life constraints: having a job, raising kids, buying a house, and stealing time where possible.

Suggested phrasing:

> I am not presenting anarcho-communism here as a grand theoretical lecture. For the game, it mostly means: no internal money, no private ownership of production, and a focus on needs, duties, care, and infrastructure. And personally, the project has followed that spirit a little bit too: I made it on the side, for the fun of it, and released the pieces freely while living an ordinary working life beside it.

## Suggested 15 Minute Structure

### 0:00-1:00 - Hook

Open with the premise.

Suggested phrasing:

> Anark-AI is a colony and logistics sandbox where a community has delegated coordination to an AI. The player is that AI.

Quickly explain the twist:

- the player is not a mayor, capitalist, king, or god;
- the player manages a commons;
- people have needs and duties;
- happiness becomes trust in the AI;
- goods, work, roads, zones, buildings, and vehicles are the language of coordination.

Mention the timing:

> I started this around a year ago, when AI still felt more like a toy. Since then AI tools became part of professional development, which is funny because the game itself is about an AI being trusted with coordination.

### 1:00-2:30 - Influences And Design Position

Use the four inspirations to make the game immediately legible.

Suggested phrasing:

> If I had to place it, I would say Settlers gives the idea that buildings decide what work exists, Factorio gives deep hive design, Simutrans gives transport and geographic prices, and SimCity gives zoning and indirect development.

Then explain the "checkboxes, not radio buttons" idea:

> The intention is not to force one play style. You can play the Settlers part, the Factorio part, the Simutrans part, the SimCity part, or several at once.

Then clarify the difference:

> But the political fantasy is different. The goal is not profit or ownership. The goal is to make a community function through shared resources, work, infrastructure, and care.

Add the purpose:

> And the main score is happiness. The AI is tolerated because it helps people live better. If it fails, the community has every reason to take power back.

Useful detail if there is time:

> The anarcho-communist difference from Settlers is that workers are not owned by buildings. Buildings and vehicles advertise duties, and free characters choose or are coordinated toward the work.

Optional personal note:

> I made this as a side project, for the fun of it, and kept the pieces free. That does not mean I live outside the real world: I have a job, kids, and a house to pay for. But the project itself follows a small version of the same idea: build something useful or interesting, and let it be shared.

This section should stay short. It gives viewers a mental map before the demo.

### 2:30-5:30 - Show The Game First

Show the playable browser client before explaining the custom tech.

Good things to show:

- hex terrain;
- the hive or colony structures;
- workers moving goods;
- harvesting, storage, construction, and transformation;
- named zones;
- roads;
- freight lines and vehicles;
- settlement commerce or city hall trade;
- inspectors and panels.

The narration should stay high-level:

> The core loop is: the community has needs, resources exist in the world, work must be coordinated, and the player shapes the systems that allow people and goods to move.

Avoid explaining every UI panel. The purpose of this section is to make the project feel real.

### 5:30-8:00 - What The Simulation Does

Now explain the project as a system.

The repository is split into:

- `engine-terrain`: deterministic terrain, hydrology, biome hints, and streamed terrain data;
- `engine-ssh`: gameplay simulation, board state, hives, jobs, storage, save/load, freight, and streamed gameplay materialization;
- `engine-pixi`: rendering, terrain sectors, entities, and visual presentation;
- `apps/browser`: the playable client, built with Sursaut panels and Pixi rendering.

Suggested phrasing:

> The renderer does not own the world. The gameplay engine owns the world. Pixi asks for what is visible; the simulation materializes it.

Then explain why this matters:

- it keeps one authoritative simulation state;
- it makes save/load and determinism easier to reason about;
- it prepares the project for Rust/WASM and eventually remote or multiplayer simulation.

### 8:00-11:00 - Why Mutts And Sursaut Exist

Explain the toolchain detour, but do not let it become the whole video.

Suggested phrasing:

> I first tried to make this with Svelte, but I kept fighting the boundary between a constantly changing simulation and the UI. Positions, values, jobs, goods, selections: everything changes all the time. I wanted the UI to follow the logic without turning the game engine into UI glue.

Then introduce the libraries:

- **Mutts**: a fine-grained reactive engine based on reactive proxies;
- **Sursaut**: a JSX frontend framework built on that reactivity;
- both are published to npm, though Anark-AI is currently the main project using them.

Key idea:

> I am not trying to make React again. I am trying to make the state of the world speak clearly enough that the interface can listen.

Mention the deeper motivation:

> There is also a nearly religious wish here to bring back something close to logic programming: model the facts, model the relations, and let behavior emerge from that structure instead of hand-wiring every update.

Keep this section conceptual. Only show code if the target audience is technical.

### 11:00-13:30 - Current State

Group current progress into three landed pillars, plus the long-term purpose they will serve:

1. **World generation**
   - deterministic terrain generation;
   - hydrology and biome classification;
   - streamed terrain snapshots;
   - continuous Pixi terrain rendering.

2. **Colony simulation**
   - hive construction and attachment;
   - harvesting, gathering, storage, transformation, and building;
   - workers and NPC-style behaviors;
   - save/load coverage;
   - named zones and assigned-zone actors such as foresters.

3. **Logistics**
   - freight lines;
   - freight bays and vehicles;
   - line inspectors and stop editing;
   - roads;
   - external settlement trade through city halls;
   - import/export of basic materials.

4. **Play-style composition**
   - Settlers-like duty offers from buildings and vehicles;
   - Factorio-like complex hive design, plus reusable hive plans for lighter play;
   - Simutrans-like geographic markets and transport networks;
   - SimCity-like zoning for residential and commercial growth;
   - industrial play through generated sites and player-designed hives.

5. **Long-term purpose**
   - the systems above are ultimately meant to support happiness and trust;
   - houses, food, comfort, tools, culture, and useful goods should become the reason logistics matters;
   - trust can become the resource that unlocks or pays for stronger AI interventions.

Suggested phrasing:

> The project is no longer just an experiment. The main pieces exist: terrain, simulation, rendering, UI, freight, roads, and the first form of external commerce.

Also be honest about the gap:

> The largest remaining product and architecture gap is turning streamed terrain into a fully first-class streamed gameplay world.

### 13:30-15:00 - Rust, WASM, And The Long-Term Shape

Explain the technical direction.

Suggested phrasing:

> I like that the game is browser-playable, and I want that to remain. But the long-term goal is for most of the engine to be written in Rust.

Describe the likely path:

- first, a Rust/WASM single-player engine that still runs in the browser;
- later, the same engine shape could support server-side simulation;
- multiplayer becomes more plausible if the authoritative simulation can run outside the client;
- explicit simulation-to-presentation events are important because they form a boundary between engine truth and UI/rendering.

Good compact phrasing:

> The browser should remain a great client. But the simulation should be portable enough to run as WASM locally or as an authoritative server later.

### 15:00-16:30 - What Comes Next

If the video runs past 15 minutes, close with the next directions.

Pick three or four:

- clearer freight and commerce diagnostics;
- roads and route-aware vehicles;
- richer settlements, shops, and NPC economies;
- happiness/trust as the main progression and pressure system.

Suggested phrasing:

> The next step is less about inventing the whole architecture and more about making the systems readable and enjoyable: why a route is idle, why cargo is retained, why an import happens, how roads or settlements change decisions, and how all of that feeds the community's trust.

### Optional 16:30-18:00 - mARC

Mention mARC only as a side note.

Suggested phrasing:

> mARC was a side project from trying to understand AI more directly. It influenced how I think about agents and representation, but Anark-AI is the main place where those ideas become playable.

Do not let this derail the main video unless the audience specifically cares about AI internals.

### Closing

End with the design ambition rather than the implementation.

Suggested phrasing:

> The dream is not just automation. It is coordination: how a community can express needs, how work can be chosen, and how infrastructure changes what becomes possible.

## Vague Script

This is not meant to be read word for word. It is a loose path through the video, with enough sentence-shapes to prevent getting lost.

### Opening

Hi. I want to show a game I have been building for around a year, called Anark-AI.

The short version is: it is a colony and logistics game where an anarcho-communist community decides to delegate coordination to an AI. And in the game, the player is that AI.

That means the player is not exactly a mayor, not a boss, not a capitalist, and not a god. The player is closer to the coordination system. The job is to understand needs, duties, resources, roads, zones, buildings, and people, then help the community organize itself.

There is a funny timing to it, because when I started, AI still felt much more like a toy. Now it is becoming a professional tool. And meanwhile I am making a game about a community asking: what if we let an AI coordinate things for us?

### Inspirations

The game is inspired by several older management games, but not in a one-to-one way.

From Settlers, I take the idea that buildings decide what work exists. A building needs something, offers a duty, and characters can do that work. But the anarcho-communist difference is that characters are not owned by buildings. They are not attached forever to one workplace. Buildings and vehicles advertise duties; people remain people.

From Factorio, I take the pleasure of building complex production systems. In Anark-AI, those are hives: player-designed industrial and logistical structures. But if someone does not want to play the full Factorio part, I want reusable hive plans too, so they can place known designs and play more like Settlers.

From Simutrans, I take routes, transport, and geography. Prices should depend on place. Near a sawmill, wood might be expensive and planks cheap. A player can play the transport game: connect places, move goods, build station-like hives, delegate construction with money, or have their own characters build things.

From SimCity, I take zoning and indirect development. Residential and commercial zones should be able to deploy automatically. Industry is different: some of it is generated by the world, and some of it is player-designed through hives.

So the idea is not that the player chooses one of these games. It is more like checkboxes. You can play mostly the Settlers part, mostly the Factorio part, mostly the Simutrans part, mostly the SimCity part, or combine several at once.

### Ideology And Purpose

The political idea is important, but I do not want to turn the video into a lecture.

For the game, anarcho-communism mostly means that inside the community there is no internal money and no private ownership of production. The interesting problem is not profit. The problem is coordination: what do people need, what work exists, what resources are available, and how can the community organize all of that?

The real score is happiness, or maybe trust.

At the beginning, that can be very basic: people need houses. But later they need good food, nice objects, useful tools, comfort, culture, gadgets, and a life that feels worth living. If the AI provides that, people trust it more. If the AI fails, they restrict it. If things go really badly, they can unplug it.

So happiness is not just a mood stat. It is legitimacy. It is the community saying: yes, this AI is helping us, we can give it more freedom. Or no, this is not working.

There is also a personal side to the project. I made this as a side project, mostly for the fun of building it and understanding the problems. The pieces are free and open, but I am not outside normal life. I have a job, kids, and a house to pay for. So it is also a small practical version of the same idea: build something interesting, share it, and keep living around it.

### Demo

Here is the game as it exists now.

This is the browser client. The world is hex-based. There is terrain, a simulation, a renderer, and an inspector UI around it.

The important thing to notice is that I am not trying to make only a map editor. There is a simulation underneath. Buildings, hives, storage, vehicles, zones, and workers are meant to create duties and flows.

Here you can see the colony/hive side: resources are gathered, goods are stored, buildings need materials, and characters perform work. Here are zones, which let the player say that an area has a role. And here are freight lines and vehicles, which are the beginning of a transport network.

The goal is that all of this becomes readable. The player should understand why a duty exists, why a route is idle, why cargo is being moved, why a building waits, and how this affects the community.

## Demo Hive

`ChopSaw` is useful because it already demonstrates several real systems: a hive, a freight bay, a wheelbarrow, a pickup truck, zones, a road, a forester, planks export, and concrete import through Melindbury. It is a good proof fixture.

For the video, though, a better example hive should be built as a small story, not only a regression fixture.

### What The Demo Hive Should Show

The ideal demo hive should make the player fantasy visible in a few minutes:

- **A community need**: people need houses, food, comfort, or materials for better life.
- **A duty source**: buildings and vehicles advertise duties instead of characters being bound to workplaces.
- **A commons loop**: storage, production, and construction serve the community rather than profit.
- **A visible logistics chain**: wood becomes planks, planks support housing or export, vehicles move goods.
- **A zone decision**: residential/commercial/forest zones change what happens automatically.
- **An external relation**: a settlement or generated industry buys/sells geographically meaningful goods.
- **A trust direction**: this is all in service of happiness, not just stockpiling.

### Possible Demo Scenario

Working name: `CommonsStart`, `New Dawn`, or `HearthLoop`.

Current fixture: `demoHive` in `engines/ssh/src/lib/game/exampleGames.ts`, using `HearthLoop` as the in-game hive name.

Suggested setup:

1. A small residential zone where one or two dwellings are needed or under construction.
2. A compact starter hive with:
   - storage;
   - engineer;
   - tree chopper;
   - sawmill;
   - forester;
   - freight bay.
3. A named forest zone assigned to the forester, so care and resource renewal are visible.
4. A wheelbarrow line that gathers wood/stone/planks around the hive.
5. A short road/path that visually connects the hive to a residential or freight area.
6. A pickup-truck line to a nearby settlement or generated industry:
   - export planks or wood where demand exists;
   - import concrete or a future comfort good;
   - show that prices are geographical, not abstract.
7. A housing project that can be completed or visibly waits for goods.
8. Optional: a small "comfort" placeholder, even if only narrated for now, to connect the loop to future happiness/trust.

### Demo Beat Order

Use the demo hive to tell the story in this order:

1. **People need homes.**
   Show residential zone or a dwelling/construction site.

2. **Buildings create duties.**
   Show that the construction site needs goods, storage has goods, and workers/vehicles can respond.

3. **The hive transforms the world.**
   Show tree chopper, forester, sawmill, storage, and freight bay as a compact production organism.

4. **Vehicles extend the hive.**
   Show a wheelbarrow or pickup truck serving a line.

5. **Geography matters.**
   Show the external settlement/trade stop and explain that prices should depend on generated places.

6. **The point is happiness/trust.**
   Close the demo by saying this is not for profit: better housing and better goods increase trust in the AI.

### ChopSaw Position

ChopSaw can remain the technical demo:

- good for showing current freight-line mechanics;
- good for showing Melindbury trade;
- good for tests and regression confidence;
- useful if a new demo fixture is not ready.

But the main video would benefit from a purpose-built demo hive whose layout and names explain themselves on screen.

Suggested phrasing:

> ChopSaw is the fixture that proves many systems work. For the video, I probably want a more narrative hive: a small community that needs housing, a forest that is cared for, a sawmill loop, a freight bay, a road, and a truck connecting us to a settlement. That tells the game better than a pure test fixture.

### Architecture

Under the hood, the project is split into a few pieces.

There is a terrain engine, which generates deterministic terrain, hydrology, biomes, and streamed terrain data.

There is the gameplay engine, called `ssh`, which owns the actual world: the board, hives, jobs, storage, save/load, freight, and gameplay materialization.

There is a Pixi renderer, which turns the simulation into visuals.

And there is the browser app, which combines the UI, panels, renderer, and simulation.

The important rule is: the renderer does not own the world. The simulation owns the world. Pixi asks what is visible, and the gameplay engine materializes the authoritative state.

That matters now, but it matters even more for the future.

### Mutts And Sursaut

Originally I tried to build this with Svelte. I like many things about Svelte, but for this project I kept fighting the boundary between a constantly changing simulation and the UI.

Positions change. Goods move. Jobs appear and disappear. Buildings change. Selections change. Vehicles move. Values change all the time.

I wanted the UI to follow the logic without turning the game engine into UI glue. So I made Mutts, a fine-grained reactive engine, and then Sursaut, a small JSX framework built on top of it.

They are published on npm, although realistically I am the main user. But they exist because the game needed them.

There is a deeper obsession behind that too. I wanted to bring back something close to logic programming: describe facts, relations, needs, duties, and consequences, then let the interface and behavior follow from that.

I am not trying to make React again. I am trying to make the state of the world speak clearly enough that the interface can listen.

### Rust And Future

Even though the browser version matters to me, the long-term goal is for most of the engine to be written in Rust.

The first target would be single-player through WASM, still enjoyable in the browser. But the same boundary could later allow server-side simulation. If the game ever gets multiplayer, the authoritative simulation should be able to run on a server, while the browser remains a client.

That is why the separation between simulation and presentation matters. The more explicit that boundary is, the easier it becomes to move the engine from TypeScript to Rust, from local WASM to server-side simulation, or from single-player to multiplayer.

### Closing

So that is Anark-AI right now: part colony game, part transport game, part production game, part city simulation, and part experiment in how to model coordination.

The next work is to make the existing systems more readable and more meaningful: better freight diagnostics, roads and route-aware vehicles, richer settlements, shops and markets, and especially happiness as trust.

The dream is not just automation. It is coordination. How can a community express needs? How can work be chosen? How can infrastructure change what becomes possible? And how much trust does an AI deserve if it is the thing coordinating all of that?

## 10 Minute Cut

For a shorter version:

- 0:00-1:00: premise and AI timing;
- 1:00-2:00: inspirations;
- 2:00-5:00: game demo;
- 5:00-7:00: simulation architecture;
- 7:00-8:30: Mutts and Sursaut;
- 8:30-9:30: Rust/WASM direction;
- 9:30-10:00: next steps and closing line.

## 20 Minute Cut

For a longer version, add:

- a concrete freight-line example;
- a small route or vehicle demo;
- a save/load or deterministic terrain explanation;
- a slightly deeper explanation of the Rust migration;
- a first design sketch of happiness as trust;
- a brief mARC aside.

## Things To Avoid

- Do not open with Mutts and Sursaut. Start with the game.
- Do not apologize that the libraries are mostly used by Anark-AI. Say they exist because the game needed them.
- Do not list every feature. Group features into world, colony, logistics, and future direction.
- Do not overexplain anarcho-communism abstractly. Show what it means mechanically: no internal money, shared resources, needs, work, distribution, and coordination.
- Do not make the personal ideology note defensive. Present it calmly as part of the project's texture.
- Do not make happiness sound like a generic score. Present it as trust and legitimacy.

## Useful One-Liners

> The player is not the ruler of the community. The player is the coordination system.

> It borrows the readable settlement life of Settlers, transport networks from Simutrans, logistics from Factorio, and indirect city-shaping from SimCity.

> The inspirations are checkboxes, not radio buttons: the player can lean into one game mode or combine several.

> Buildings and vehicles offer duties; characters are not owned by those buildings.

> Inside the community, there is no money. The interesting problem is not profit; it is coordination.

> Happiness is trust. If people believe the AI improves their lives, they give it more freedom. If not, they can unplug it.

> I made this on the side, for the fun of it, and released the pieces freely while still living a normal working life around it.

> The renderer does not own the world. The simulation owns the world.

> The browser should remain a great client, but the simulation should be portable enough to run as WASM locally or as an authoritative server later.

> I am not trying to make React again. I am trying to make the state of the world speak clearly enough that the interface can listen.
