/* ============================================================
   What the Wether V8 — local-ai.js
   Local AI 2.0: a fully offline roast generator. No API key,
   no cloud, no network. It reacts to temperature, rain, snow,
   thunderstorms, wind, fog, extreme heat, cold and clear skies,
   supports four personalities, and remembers its recent lines
   so it doesn't repeat itself constantly.
   ============================================================ */

const LocalAI = (() => {
  /* ------------------------------------------------------------
     Condition detection.
     Priority matters: a thunderstorm is a thunderstorm even if
     it's also windy and cold.
     ------------------------------------------------------------ */
  function detectCategory(w) {
    const code = w.weatherCode ?? 0;
    const t = w.tempF ?? 70;
    const wind = w.windMph ?? 0;

    if (code >= 95) return 'thunder';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if (code === 45 || code === 48) return 'fog';
    if (t >= 95) return 'extremeHeat';
    if (wind >= 22) return 'wind';
    if (t <= 15) return 'extremeCold';
    if (t <= 40) return 'cold';
    if (t >= 85) return 'hot';
    if (code >= 2 && code <= 3) return 'clouds';
    return 'clear';
  }

  /* ------------------------------------------------------------
     Roast template pools.
     {name} = username, {temp} = °F, {city} = place name,
     {wind} = wind mph, {feels} = feels-like °F.
     Keep it funny/rude, never hateful or discriminatory.
     ------------------------------------------------------------ */
  const POOLS = {
    friendly: {
      thunder: [
        "Thunderstorms in {city}, {name}! The sky is putting on a free light show — enjoy it from the couch. ⛈️",
        "Boom boom time, {name}. Maybe unplug the fancy electronics and make some cocoa.",
        "The clouds are having a drum solo over {city}. Stay cozy and let them cook.",
        "Lightning says hi, {name}! It's a great day to be indoors and smug about it.",
        "Storm's rolling through {city} — perfect excuse to cancel plans you didn't want anyway. 😉",
        "It's giving 'dramatic movie scene' out there. Stay safe, {name}!",
      ],
      snow: [
        "Snow day vibes in {city}, {name}! ☃️ Time for hot chocolate and zero responsibilities.",
        "The sky is shedding glitter over {city}. Bundle up, buddy!",
        "Snowflakes incoming, {name} — every one unique, just like you. Aww. Now grab a coat.",
        "Winter wonderland mode: ON. Drive slow and waddle carefully, {name}.",
        "It's {temp}°F and snowing — basically a free postcard outside your window.",
      ],
      rain: [
        "Rain in {city} today, {name}. Free plant-watering service, courtesy of the sky! 🌧️",
        "Grab the umbrella, {name} — the clouds are feeling generous today.",
        "A little rain never hurt anybody. Your hair, maybe. You? Never.",
        "Cozy rain sounds over {city} — nature's white noise machine, no subscription needed.",
        "Wet one out there, {name}. Perfect day to look thoughtfully out a window.",
      ],
      fog: [
        "Foggy in {city}, {name} — the world got the soft-focus filter today. Drive careful!",
        "Visibility: mysterious. Vibes: immaculate. Take it slow out there, {name}.",
        "The clouds came down for a visit. Say hi, but use your low beams.",
      ],
      wind: [
        "Breezy {wind} mph in {city}, {name}! Free hair styling all day long. 💨",
        "The wind is showing off today. Hold onto your hat and your dignity.",
        "It's {wind} mph out there — the trees are doing cardio. Maybe skip the umbrella.",
        "Windy one, {name}! Great day to feel dramatic in a long coat.",
      ],
      extremeHeat: [
        "Whew, {temp}°F in {city}! Hydrate like it's your job today, {name}. 🥵",
        "It's officially oven weather, {name}. Find shade, find water, find AC — in that order.",
        "{temp}°F?! Even the sun is showing off. Take it easy out there, friend.",
        "Hot hot hot! {temp}°F in {city}. Ice cream is basically medicine today.",
      ],
      extremeCold: [
        "{temp}°F in {city}?! That's freezer aisle weather, {name}. Layer up like a burrito! 🧊",
        "Brrr, {temp}°F! Your breath gets its own weather system today. Stay warm, {name}!",
        "It is COLD cold out there, {name}. Two pairs of socks kind of day.",
      ],
      cold: [
        "Chilly {temp}°F in {city} today — sweater weather at full power, {name}! 🧣",
        "Nippy one out there, {name}. Warm drinks are 40% more delicious today. It's science.",
        "{temp}°F — cold enough to complain about, warm enough to survive. You've got this.",
        "Jacket weather, {name}! The crisp air is free, enjoy responsibly.",
      ],
      hot: [
        "Toasty {temp}°F in {city}, {name}! Sunscreen now, thank yourself later. ☀️",
        "It's a warm one — {temp}°F. Perfect excuse for something cold and delicious.",
        "Summer is summering at {temp}°F. Shade is your best friend today, {name}.",
      ],
      clouds: [
        "Cloudy in {city} today — the sun is working from home, {name}. ☁️",
        "Gray skies, great vibes. It's basically mood lighting for the whole city.",
        "The clouds are hogging the view, but hey — no squinting today, {name}!",
        "Overcast and comfy in {city}. The sky said 'soft launch' today.",
      ],
      clear: [
        "Clear skies over {city}, {name}! Go outside and get that free vitamin D. 😎",
        "Not a cloud in sight — the sky really said 'you're welcome' today.",
        "Beautiful and clear at {temp}°F. Whatever you were putting off outside? Today's the day.",
        "Blue skies in {city}! Even the weather is rooting for you today, {name}.",
      ],
    },

    sassy: {
      thunder: [
        "Thunderstorms over {city}. The sky is throwing a tantrum and honestly, {name}? Relatable. ⛈️",
        "Lightning AND thunder? The atmosphere is being SO dramatic today. Stay inside, {name}.",
        "The sky is yelling at {city} right now. Don't take it personally. Or do. 💅",
        "Zeus is in his feelings again. Maybe don't stand under anything tall, {name}.",
        "A thunderstorm, how theatrical. The clouds clearly didn't get enough attention as kids.",
        "Storm's here. Great day to dramatically stare out a window like you're in a music video, {name}.",
      ],
      snow: [
        "Snow in {city}. Gorgeous to look at, miserable to shovel. Choose your fighter, {name}. ❄️",
        "Oh look, the sky's dandruff is falling all over {city} again.",
        "It's snowing, {name}. Time to watch everyone forget how to drive in real time.",
        "Snow: nature's way of saying 'stay home in your blanket burrito.' Who are we to argue?",
        "{temp}°F and snowing. Winter said 'and what about it?'",
      ],
      rain: [
        "Rain again in {city}? The clouds seriously need a new hobby, {name}. 🌧️",
        "It's wet out there. Your hair had plans? The sky said no. Sorry, {name}.",
        "The sky is crying over {city}. Somebody check on it, I guess.",
        "Rain at {temp}°F. Perfect weather for cancelling plans you were 'totally' going to keep, {name}.",
        "Umbrella check, {name}. Yes, that one you left... somewhere. Classic.",
      ],
      fog: [
        "Fog in {city}. The weather chose 'mysterious' as its whole personality today. 🌫️",
        "Can't see a thing out there, {name}. The sky is playing hide and seek and winning.",
        "Foggy with a chance of walking into things. Good luck out there, {name}.",
      ],
      wind: [
        "{wind} mph winds, {name}. Your hairstyle is about to be a group decision with the atmosphere. 💨",
        "It's giving wind tunnel in {city} today. Secure your trash cans and your ego.",
        "The wind is {wind} mph and full of opinions today. Dress accordingly, {name}.",
        "Breezy? No honey, it's {wind} mph. That's the sky doing crossfit.",
      ],
      extremeHeat: [
        "{temp}°F in {city}?! The sun woke up and chose violence, {name}. 🔥",
        "It's {temp}°F. Outside is now an air fryer. You've been warned, {name}.",
        "The pavement is basically lava and so is everything else. {temp}°F. Stay inside, sweetie.",
        "{temp}°F, feels like {feels}°F. Even your ice cubes are sweating, {name}.",
      ],
      extremeCold: [
        "{temp}°F in {city}. The air hurts your face and honestly? Rude of it. 🥶",
        "It's {temp}°F, {name}. Your car needs ten minutes and a pep talk this morning.",
        "{temp}°F outside. Going out unprepared is a choice — a bad one, {name}.",
      ],
      cold: [
        "{temp}°F in {city}. Cold enough to whine about, and you WILL, won't you {name}? 🧊",
        "Sweater weather called. It said stop pretending that hoodie counts, {name}.",
        "A brisk {temp}°F out there. The air is crunchy today. Enjoy.",
        "It's {temp}°F. Yes you need the jacket. No, don't argue with me, {name}.",
      ],
      hot: [
        "{temp}°F in {city}. Sticky, sweaty, and glorious — much like your gym playlist, {name}. ☀️",
        "Warm one today — {temp}°F. Deodorant is not optional, just saying.",
        "It's {temp}°F. The sun is doing the absolute most, as usual.",
      ],
      clouds: [
        "Cloudy over {city}. The sun called in sick. Again. Typical. ☁️",
        "Gray skies today, {name}. The weather is matching your Monday energy.",
        "50 shades of gray up there and none of them interesting. Carry on, {name}.",
        "Overcast in {city}. The sky couldn't commit to a decision either, {name}. Twins!",
      ],
      clear: [
        "Clear skies and {temp}°F in {city}. Even the weather has its life together today. Unlike some of us, {name}. 😌",
        "Not a cloud in sight. The sky is showing off. Go outside so it wasn't for nothing, {name}.",
        "Gorgeous out there. If you stay in and scroll all day, that's between you and the sun, {name}.",
        "It's stunning outside, {name}. Yes, outside. That place beyond the fridge.",
      ],
    },

    rude: {
      thunder: [
        "Thunderstorm over {city}. Even the sky's yelling at you now, {name}. Get in line, buddy. ⛈️",
        "Hear that thunder? That's the universe reviewing your life choices, {name}. One star.",
        "Lightning outside, {name}. For once, the flashing lights aren't about your driving.",
        "The sky is having a full meltdown over {city}. It heard about your weekend plans.",
        "Storm's raging out there. Stay inside — nobody wants to see you get humbled by weather.",
      ],
      snow: [
        "Snow in {city}, {name}. Enjoy scraping your car with a spatula because you lost the scraper. Again.",
        "It's snowing. Time for you to shovel — that's the most exercise you'll get all year, {name}. ❄️",
        "{temp}°F and snowing. Mother Nature said 'suffer' and honestly, fair.",
        "Snowflakes everywhere, {name}. Cold, flaky, and all over the place. Sound familiar?",
        "Snow again. Watch out for that one patch of ice — it's got your name on it, {name}.",
      ],
      rain: [
        "Rain in {city}. You'll forget your umbrella anyway, {name}. You always do. 🌧️",
        "It's pouring, {name}. Even the sky is crying about your fantasy team.",
        "Rain all day. Your plans were bad anyway — consider this a rescue, {name}.",
        "Wet and miserable out there. So basically the weather is doing an impression of your texts, {name}.",
        "Rain at {temp}°F. Nature's way of saying stay in, {name}. Listen to it for once.",
      ],
      fog: [
        "Fog in {city} thicker than your last excuse, {name}. Drive slow. 🌫️",
        "Can't see 20 feet out there. Perfect — nobody can see you in yesterday's shirt, {name}.",
        "Foggy and gray, {name}. The sky's as unclear about its direction as you are.",
      ],
      wind: [
        "{wind} mph winds in {city}. Hold onto something, {name} — preferably your last shred of dignity. 💨",
        "It's blowing {wind} mph out there. Your comb-over doesn't stand a chance, {name}.",
        "Wind's at {wind} mph, {name}. Even the air wants you to stay home today.",
        "Gusty out there. If you hear howling, it's the wind. Probably. Anyway, good luck, {name}.",
      ],
      extremeHeat: [
        "{temp}°F in {city}. You're gonna sweat through that shirt in four minutes, {name}. Bring backup. 🔥",
        "It's {temp}°F, {name}. Satan called — even he thinks this is a bit much.",
        "{temp}°F out there. Your car seat is now a George Foreman grill. Enjoy, {name}.",
        "Feels like {feels}°F. Go outside if you want, {name}, but you'll come back looking like a boiled ham.",
      ],
      extremeCold: [
        "{temp}°F in {city}, {name}. Your face is going to hurt. More than usual, I mean. 🥶",
        "It's {temp}°F. Your phone battery will die faster than your motivation, {name}.",
        "{temp}°F out there. Even penguins would file a complaint. Bundle up, genius.",
      ],
      cold: [
        "{temp}°F in {city} and you're STILL going to wear shorts, aren't you {name}? Clown behavior.",
        "It's {temp}°F, {name}. That thin little jacket of yours is a decoration, not a plan.",
        "Cold and gray, just like your leftovers, {name}. Wear layers.",
        "{temp}°F today. Time to dig out the winter coat that still has last year's receipts in it, {name}.",
      ],
      hot: [
        "{temp}°F in {city}. You + humidity = a walking swamp, {name}. Godspeed. 🥵",
        "It's {temp}°F out. Your AC bill is about to roast you harder than I ever could, {name}.",
        "Hot one today, {name}. Pit stains are inevitable. Own them.",
      ],
      clouds: [
        "Gray and gloomy over {city}. The sky saw your schedule and lost the will too, {name}. ☁️",
        "100% clouds, 0% effort from the sun. It's matching your energy, {name}.",
        "Overcast all day, {name}. Even the sun ghosted you.",
        "Cloudy in {city}. Dull, gray, uninspired — the sky is basically your group chat.",
      ],
      clear: [
        "Clear and sunny in {city}, {name}. Zero excuses left for skipping your run. Zero.",
        "Beautiful day out. Shame you'll spend it indoors arguing with strangers online, {name}. 😎",
        "Not a single cloud, {name}. The sky did its job today. Your move.",
        "Sunny and {temp}°F. Perfect weather, wasted on you, {name}.",
      ],
    },

    brutal: {
      thunder: [
        "Thunderstorm over {city}. The sky is airing out its rage, {name} — the only thing louder than your snoring. ⛈️",
        "Lightning's tearing up the sky and it's STILL not the biggest disaster in {city} today. Stay inside, {name}.",
        "Thunder that loud means even the atmosphere is done pretending, {name}. Take notes.",
        "The storm out there has more direction in five minutes than your five-year plan, {name}. Respect it. Stay in.",
        "Sky's throwing hands over {city}. For your own safety, don't give it a reason, {name}.",
      ],
      snow: [
        "Snow in {city}, {name}. White, cold, and relentless — like the lies you tell your dentist about flossing. ❄️",
        "{temp}°F and snowing. Mother Nature is beating {city} like it owes her money.",
        "It's dumping snow, {name}. Your back will give out shoveling before your excuses do.",
        "Snowstorm inbound. Everything will be buried, {name} — much like your New Year's resolutions.",
        "Snow again. You'll fall on the ice at least once today, {name}, and I want you to know: someone will see it.",
      ],
      rain: [
        "Rain hammering {city} all day, {name}. The sky's sobbing harder than you did at your last haircut. 🌧️",
        "It's absolutely pouring, {name}. Even the clouds gave up on {city} — and they've seen everything.",
        "Rain, rain, and more rain. Wet socks are coming for you today, {name}, and you deserve them.",
        "100% chance of rain, 0% chance you remember your umbrella. Some things never change, {name}.",
        "The sky is unloading on {city} like it's personal. Knowing you, {name}? It might be.",
      ],
      fog: [
        "Fog so thick over {city} you can't see your own bad decisions coming, {name}. That's new for you. 🌫️",
        "Zero visibility out there, {name}. The universe finally made everyone as lost as you are.",
        "Foggy in {city}. The weather is gaslighting the entire town. You'd know all about that, {name}.",
      ],
      wind: [
        "{wind} mph winds, {name}. The atmosphere is swinging on {city} — and it's still gentler than your last performance review. 💨",
        "The wind is {wind} mph. It could carry away everything you own, which, let's be honest {name}, wouldn't take long.",
        "Gale-force attitude out there. The wind's had a worse week than you, {name}, and it's taking it out on everyone.",
        "{wind} mph gusts. Walk outside and get flung into next week — honestly might be an upgrade for you, {name}.",
      ],
      extremeHeat: [
        "{temp}°F in {city}. The sun is trying to delete you specifically, {name}. Stay inside and hydrate, you rotisserie chicken. 🔥",
        "It's {temp}°F, feels like {feels}°F. Outside is a crime scene and you're the next victim, {name}.",
        "{temp}°F. The devil checked the forecast for {city} and went 'nope, too much.' What's your plan, {name}?",
        "It is DANGEROUSLY hot, {name}. Today the sun does to you what leg day never could: total destruction.",
      ],
      extremeCold: [
        "{temp}°F in {city}. Cold enough to freeze your excuses mid-sentence, {name}. Nothing survives out there — especially not your attitude. 🥶",
        "It's {temp}°F, {name}. Exposed skin goes numb in minutes. So does anyone who reads your posts, but that's unrelated.",
        "{temp}°F. The air will slap you harder than reality ever has, {name}, and that's saying something.",
      ],
      cold: [
        "{temp}°F and gray in {city}, {name}. Even the thermometer is embarrassed. Wear the big coat — nobody's impressed by your goosebumps.",
        "It's {temp}°F. Your 'I don't get cold' era ends today, {name}, in front of everyone.",
        "Cold enough to see your breath — the most substantial thing you've produced all week, {name}.",
        "{temp}°F out there. Winter is billing {city} for services no one ordered. Pay up in layers, {name}.",
      ],
      hot: [
        "{temp}°F in {city}. You're about to sweat like you're being interrogated, {name} — and honestly, you'd fold immediately.",
        "It's {temp}°F. Between you and the humidity, the swamp look is fully back, {name}. 🥵",
        "Hot and sticky all day. Your car is an oven, your shirt is a towel, and your deodorant is a prayer, {name}.",
      ],
      clouds: [
        "Wall-to-wall clouds over {city}. Even the sun looked at today and said 'nah', {name}. Take the hint. ☁️",
        "Gray, flat, and lifeless out there — the sky is doing an impression of your small talk, {name}.",
        "Complete cloud cover, {name}. The sun ghosted {city} entirely. It learned that from watching you.",
        "The sky is one giant gray shrug today, {name}. Finally, weather that matches your effort level.",
      ],
      clear: [
        "Perfectly clear skies over {city}, {name}. Nature did its part flawlessly. The weak link today is, as always, you.",
        "Not one cloud. {temp}°F. Absolutely zero excuses, {name} — today the only forecast for failure is you. 😎",
        "It's gorgeous out. Go touch grass, {name}. The grass has been asking about you. It's worried.",
        "Flawless blue sky over {city} and you're inside reading a weather app roast you. Think about that, {name}.",
      ],
    },
  };

  // Occasional openers to add extra variety (used ~30% of the time).
  const OPENERS = {
    friendly: ['Hey {name}!', 'Good news-ish, {name}:', 'Weather check, {name}:', 'Psst, {name} —'],
    sassy: ['Okay so, {name}...', 'Bulletin for {name}:', 'Deep breath, {name} —', 'Girl. {name}. Listen.'],
    rude: ['Listen up, {name}.', 'Bad news, {name}.', 'Oh great, {name} —', 'Heads up, champ:'],
    brutal: ['Brace yourself, {name}.', 'No sugarcoating this, {name}:', 'Sit down for this one, {name}.', 'Condolences in advance, {name}:'],
  };

  /* ------------------------------------------------------------
     Anti-repeat picker: avoids any template used in the recent
     history (persisted via storage.js). When a pool is exhausted
     the history for that pool resets.
     ------------------------------------------------------------ */
  function pickTemplate(personality, category) {
    const pool = (POOLS[personality] && POOLS[personality][category]) ||
                 POOLS.sassy.clear;
    const history = WTWStorage.getRoastHistory();
    const poolKey = `${personality}:${category}`;

    let candidates = pool
      .map((text, i) => ({ id: `${poolKey}:${i}`, text }))
      .filter((c) => !history.includes(c.id));

    if (candidates.length === 0) {
      // Every line in this pool was used recently — clear that
      // pool's history and start over.
      const cleaned = history.filter((id) => !id.startsWith(poolKey + ':'));
      WTWStorage.saveRoastHistory(cleaned);
      candidates = pool.map((text, i) => ({ id: `${poolKey}:${i}`, text }));
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const newHistory = WTWStorage.getRoastHistory();
    newHistory.push(chosen.id);
    WTWStorage.saveRoastHistory(newHistory);
    return chosen.text;
  }

  function fill(template, w, name) {
    return template
      .replaceAll('{name}', name)
      .replaceAll('{city}', w.city || 'your town')
      .replaceAll('{temp}', Math.round(w.tempF ?? 0))
      .replaceAll('{feels}', Math.round(w.feelsLikeF ?? w.tempF ?? 0))
      .replaceAll('{wind}', Math.round(w.windMph ?? 0));
  }

  /* ------------------------------------------------------------
     Public API.
     weather = { tempF, feelsLikeF, windMph, weatherCode, city }
     ------------------------------------------------------------ */
  function generate(weather, options = {}) {
    const settings = WTWStorage.getSettings();
    const personality = options.personality || settings.personality || 'sassy';
    const name = options.username || settings.username || 'friend';
    const safePersonality = POOLS[personality] ? personality : 'sassy';

    const category = detectCategory(weather || {});
    let line = pickTemplate(safePersonality, category);

    // ~30% of the time, prepend a personality opener (unless the
    // template already leads with the name).
    const openers = OPENERS[safePersonality] || [];
    if (openers.length && Math.random() < 0.3 && !line.startsWith('{name}')) {
      const opener = openers[Math.floor(Math.random() * openers.length)];
      line = `${opener} ${line}`;
    }

    return fill(line, weather || {}, name);
  }

  return { generate, detectCategory };
})();

window.LocalAI = LocalAI;
