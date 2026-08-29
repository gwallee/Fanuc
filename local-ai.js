/* ============================================================
   What the Wether V16 — local-ai.js
   Local AI 3.0: a fully offline roast generator. No API key,
   no cloud, no network. It reacts to temperature, rain, snow,
   thunderstorms, wind, fog, extreme heat, cold and clear skies,
   supports six personalities, roasts any day in the forecast,
   and remembers its recent lines so it doesn't repeat itself.
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
     {name} = username, {city} = place name.
     {tempU}/{feelsU}/{windU} carry the reader's chosen units
     ("91°F" or "33°C", "12 mph" or "19 km/h"); {temp}/{feels}/{wind}
     are the bare converted numbers.
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
        "It's {tempU} and snowing — basically a free postcard outside your window.",
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
        "Breezy {windU} in {city}, {name}! Free hair styling all day long. 💨",
        "The wind is showing off today. Hold onto your hat and your dignity.",
        "It's {windU} out there — the trees are doing cardio. Maybe skip the umbrella.",
        "Windy one, {name}! Great day to feel dramatic in a long coat.",
      ],
      extremeHeat: [
        "Whew, {tempU} in {city}! Hydrate like it's your job today, {name}. 🥵",
        "It's officially oven weather, {name}. Find shade, find water, find AC — in that order.",
        "{tempU}?! Even the sun is showing off. Take it easy out there, friend.",
        "Hot hot hot! {tempU} in {city}. Ice cream is basically medicine today.",
      ],
      extremeCold: [
        "{tempU} in {city}?! That's freezer aisle weather, {name}. Layer up like a burrito! 🧊",
        "Brrr, {tempU}! Your breath gets its own weather system today. Stay warm, {name}!",
        "It is COLD cold out there, {name}. Two pairs of socks kind of day.",
      ],
      cold: [
        "Chilly {tempU} in {city} today — sweater weather at full power, {name}! 🧣",
        "Nippy one out there, {name}. Warm drinks are 40% more delicious today. It's science.",
        "{tempU} — cold enough to complain about, warm enough to survive. You've got this.",
        "Jacket weather, {name}! The crisp air is free, enjoy responsibly.",
      ],
      hot: [
        "Toasty {tempU} in {city}, {name}! Sunscreen now, thank yourself later. ☀️",
        "It's a warm one — {tempU}. Perfect excuse for something cold and delicious.",
        "Summer is summering at {tempU}. Shade is your best friend today, {name}.",
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
        "Beautiful and clear at {tempU}. Whatever you were putting off outside? Today's the day.",
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
        "{tempU} and snowing. Winter said 'and what about it?'",
      ],
      rain: [
        "Rain again in {city}? The clouds seriously need a new hobby, {name}. 🌧️",
        "It's wet out there. Your hair had plans? The sky said no. Sorry, {name}.",
        "The sky is crying over {city}. Somebody check on it, I guess.",
        "Rain at {tempU}. Perfect weather for cancelling plans you were 'totally' going to keep, {name}.",
        "Umbrella check, {name}. Yes, that one you left... somewhere. Classic.",
      ],
      fog: [
        "Fog in {city}. The weather chose 'mysterious' as its whole personality today. 🌫️",
        "Can't see a thing out there, {name}. The sky is playing hide and seek and winning.",
        "Foggy with a chance of walking into things. Good luck out there, {name}.",
      ],
      wind: [
        "{windU} winds, {name}. Your hairstyle is about to be a group decision with the atmosphere. 💨",
        "It's giving wind tunnel in {city} today. Secure your trash cans and your ego.",
        "The wind is {windU} and full of opinions today. Dress accordingly, {name}.",
        "Breezy? No honey, it's {windU}. That's the sky doing crossfit.",
      ],
      extremeHeat: [
        "{tempU} in {city}?! The sun woke up and chose violence, {name}. 🔥",
        "It's {tempU}. Outside is now an air fryer. You've been warned, {name}.",
        "The pavement is basically lava and so is everything else. {tempU}. Stay inside, sweetie.",
        "{tempU}, feels like {feelsU}. Even your ice cubes are sweating, {name}.",
      ],
      extremeCold: [
        "{tempU} in {city}. The air hurts your face and honestly? Rude of it. 🥶",
        "It's {tempU}, {name}. Your car needs ten minutes and a pep talk this morning.",
        "{tempU} outside. Going out unprepared is a choice — a bad one, {name}.",
      ],
      cold: [
        "{tempU} in {city}. Cold enough to whine about, and you WILL, won't you {name}? 🧊",
        "Sweater weather called. It said stop pretending that hoodie counts, {name}.",
        "A brisk {tempU} out there. The air is crunchy today. Enjoy.",
        "It's {tempU}. Yes you need the jacket. No, don't argue with me, {name}.",
      ],
      hot: [
        "{tempU} in {city}. Sticky, sweaty, and glorious — much like your gym playlist, {name}. ☀️",
        "Warm one today — {tempU}. Deodorant is not optional, just saying.",
        "It's {tempU}. The sun is doing the absolute most, as usual.",
      ],
      clouds: [
        "Cloudy over {city}. The sun called in sick. Again. Typical. ☁️",
        "Gray skies today, {name}. The weather is matching your Monday energy.",
        "50 shades of gray up there and none of them interesting. Carry on, {name}.",
        "Overcast in {city}. The sky couldn't commit to a decision either, {name}. Twins!",
      ],
      clear: [
        "Clear skies and {tempU} in {city}. Even the weather has its life together today. Unlike some of us, {name}. 😌",
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
        "{tempU} and snowing. Mother Nature said 'suffer' and honestly, fair.",
        "Snowflakes everywhere, {name}. Cold, flaky, and all over the place. Sound familiar?",
        "Snow again. Watch out for that one patch of ice — it's got your name on it, {name}.",
      ],
      rain: [
        "Rain in {city}. You'll forget your umbrella anyway, {name}. You always do. 🌧️",
        "It's pouring, {name}. Even the sky is crying about your fantasy team.",
        "Rain all day. Your plans were bad anyway — consider this a rescue, {name}.",
        "Wet and miserable out there. So basically the weather is doing an impression of your texts, {name}.",
        "Rain at {tempU}. Nature's way of saying stay in, {name}. Listen to it for once.",
      ],
      fog: [
        "Fog in {city} thicker than your last excuse, {name}. Drive slow. 🌫️",
        "Can't see 20 feet out there. Perfect — nobody can see you in yesterday's shirt, {name}.",
        "Foggy and gray, {name}. The sky's as unclear about its direction as you are.",
      ],
      wind: [
        "{windU} winds in {city}. Hold onto something, {name} — preferably your last shred of dignity. 💨",
        "It's blowing {windU} out there. Your comb-over doesn't stand a chance, {name}.",
        "Wind's at {windU}, {name}. Even the air wants you to stay home today.",
        "Gusty out there. If you hear howling, it's the wind. Probably. Anyway, good luck, {name}.",
      ],
      extremeHeat: [
        "{tempU} in {city}. You're gonna sweat through that shirt in four minutes, {name}. Bring backup. 🔥",
        "It's {tempU}, {name}. Satan called — even he thinks this is a bit much.",
        "{tempU} out there. Your car seat is now a George Foreman grill. Enjoy, {name}.",
        "Feels like {feelsU}. Go outside if you want, {name}, but you'll come back looking like a boiled ham.",
      ],
      extremeCold: [
        "{tempU} in {city}, {name}. Your face is going to hurt. More than usual, I mean. 🥶",
        "It's {tempU}. Your phone battery will die faster than your motivation, {name}.",
        "{tempU} out there. Even penguins would file a complaint. Bundle up, genius.",
      ],
      cold: [
        "{tempU} in {city} and you're STILL going to wear shorts, aren't you {name}? Clown behavior.",
        "It's {tempU}, {name}. That thin little jacket of yours is a decoration, not a plan.",
        "Cold and gray, just like your leftovers, {name}. Wear layers.",
        "{tempU} today. Time to dig out the winter coat that still has last year's receipts in it, {name}.",
      ],
      hot: [
        "{tempU} in {city}. You + humidity = a walking swamp, {name}. Godspeed. 🥵",
        "It's {tempU} out. Your AC bill is about to roast you harder than I ever could, {name}.",
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
        "Sunny and {tempU}. Perfect weather, wasted on you, {name}.",
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
        "{tempU} and snowing. Mother Nature is beating {city} like it owes her money.",
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
        "{windU} winds, {name}. The atmosphere is swinging on {city} — and it's still gentler than your last performance review. 💨",
        "The wind is {windU}. It could carry away everything you own, which, let's be honest {name}, wouldn't take long.",
        "Gale-force attitude out there. The wind's had a worse week than you, {name}, and it's taking it out on everyone.",
        "{windU} gusts. Walk outside and get flung into next week — honestly might be an upgrade for you, {name}.",
      ],
      extremeHeat: [
        "{tempU} in {city}. The sun is trying to delete you specifically, {name}. Stay inside and hydrate, you rotisserie chicken. 🔥",
        "It's {tempU}, feels like {feelsU}. Outside is a crime scene and you're the next victim, {name}.",
        "{tempU}. The devil checked the forecast for {city} and went 'nope, too much.' What's your plan, {name}?",
        "It is DANGEROUSLY hot, {name}. Today the sun does to you what leg day never could: total destruction.",
      ],
      extremeCold: [
        "{tempU} in {city}. Cold enough to freeze your excuses mid-sentence, {name}. Nothing survives out there — especially not your attitude. 🥶",
        "It's {tempU}, {name}. Exposed skin goes numb in minutes. So does anyone who reads your posts, but that's unrelated.",
        "{tempU}. The air will slap you harder than reality ever has, {name}, and that's saying something.",
      ],
      cold: [
        "{tempU} and gray in {city}, {name}. Even the thermometer is embarrassed. Wear the big coat — nobody's impressed by your goosebumps.",
        "It's {tempU}. Your 'I don't get cold' era ends today, {name}, in front of everyone.",
        "Cold enough to see your breath — the most substantial thing you've produced all week, {name}.",
        "{tempU} out there. Winter is billing {city} for services no one ordered. Pay up in layers, {name}.",
      ],
      hot: [
        "{tempU} in {city}. You're about to sweat like you're being interrogated, {name} — and honestly, you'd fold immediately.",
        "It's {tempU}. Between you and the humidity, the swamp look is fully back, {name}. 🥵",
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
        "Not one cloud. {tempU}. Absolutely zero excuses, {name} — today the only forecast for failure is you. 😎",
        "It's gorgeous out. Go touch grass, {name}. The grass has been asking about you. It's worried.",
        "Flawless blue sky over {city} and you're inside reading a weather app roast you. Think about that, {name}.",
      ],
    },

    deadpan: {
      thunder: [
        "Thunderstorm in {city}. Loud noise, bright light, water falls down. Nature is not subtle, {name}.",
        "There is lightning. It is electricity. It does not care about your plans, {name}.",
        "A thunderstorm is happening. This is normal. It is also very loud. Stay inside.",
        "Sky makes noise. Ground gets wet. Repeat until further notice, {name}.",
        "Statistically you will be fine, {name}. Emotionally, that thunder is still going to make you jump.",
      ],
      snow: [
        "It is snowing in {city}. Water, but organized. {tempU}.",
        "Snow is falling, {name}. Every flake is unique. Collectively they are a driveway problem.",
        "{tempU} and snowing. The roads will be worse than you think and you will drive on them anyway.",
        "Frozen water is descending on {city} at a steady rate. Wear the boots, {name}.",
      ],
      rain: [
        "It is raining in {city}. Water is arriving from above at no charge, {name}.",
        "Rain. {tempU}. Your shoes will absorb more of it than you expect.",
        "Precipitation is occurring. An umbrella would address this, {name}. You will not bring one.",
        "The sky is releasing water over {city}. This has happened before and will happen again.",
      ],
      fog: [
        "Fog in {city}. Visibility reduced. Confidence should be too, {name}.",
        "There is fog. Things are where they were, you just cannot see them. Drive accordingly.",
        "Suspended water droplets are limiting your vision, {name}. Slow down.",
      ],
      wind: [
        "Wind at {windU} in {city}. Objects will move. Some of them are yours, {name}.",
        "The air is moving quickly. Your hair has already lost this argument.",
        "{windU}. Loose items become airborne items. Plan accordingly, {name}.",
      ],
      extremeHeat: [
        "{tempU} in {city}. That is hot. Not interesting-hot. Concerning-hot. Drink water, {name}.",
        "It is {tempU}, feels like {feelsU}. Your body will attempt to cool itself. It will lose.",
        "{tempU}. Shade is free and you should use it, {name}.",
      ],
      extremeCold: [
        "{tempU} in {city}. Exposed skin will become numb. This is not a metaphor, {name}.",
        "It is {tempU}. Your car will start eventually. Probably.",
        "{tempU}. Wear more clothing than you believe is necessary, {name}. You are wrong about the amount.",
      ],
      cold: [
        "{tempU} in {city}. That is jacket weather. You own a jacket, {name}. Use it.",
        "It is {tempU}. Cold, but survivable. Most things are.",
        "{tempU}. You will complain about this and then complain about summer, {name}. Consistent.",
      ],
      hot: [
        "{tempU} in {city}. Warm. Sticky. Familiar, {name}.",
        "It is {tempU}. You will sweat. Everyone will sweat. We do not need to discuss it further.",
        "{tempU} out. Sunscreen exists and works, {name}.",
      ],
      clouds: [
        "Cloudy in {city}. The sun is present but unavailable, {name}.",
        "Grey. Uniformly. All day. That is the report.",
        "Cloud cover is total. Nothing further to add, {name}.",
      ],
      clear: [
        "Clear skies in {city}, {tempU}. Conditions are good. You may go outside, {name}. That is allowed.",
        "No clouds. No excuses. Just a functioning sky, {name}.",
        "The weather is fine. This is the part where you do the thing you said you would do, {name}.",
        "{tempU} and clear. Objectively pleasant. Act on it.",
      ],
    },

    doomer: {
      thunder: [
        "Thunderstorm over {city}. The sky is finally saying out loud what we've all been thinking, {name}.",
        "Lightning again. Every flash is just the universe taking a photo for the records, {name}.",
        "The storm will pass. So will everything else. Anyway, don't stand under a tree, {name}.",
        "Thunder over {city}. Somewhere a basement is flooding and it might be yours, {name}.",
      ],
      snow: [
        "Snow in {city}, {tempU}. It'll be beautiful for an hour and grey slush for a month, {name}.",
        "It's snowing. It'll melt. It'll snow again. This is the whole thing, {name}.",
        "{tempU} and snowing. Somewhere under all that white is a driveway you'll never fully clear.",
      ],
      rain: [
        "Rain over {city}, {name}. The sky's been doing this for four billion years and still hasn't worked it out.",
        "It's raining. It was always going to rain. Bring the umbrella you already lost, {name}.",
        "Rain at {tempU}. Everything gets wet, everything dries, nothing is learned, {name}.",
      ],
      fog: [
        "Fog in {city}. Can't see ahead. Honestly, {name}, that's just Tuesday with extra atmosphere.",
        "Visibility is gone. So is the horizon. So is the plan, {name}.",
        "Thick fog over {city}. The world shrank to about forty feet. Could be worse. Will be, probably.",
      ],
      wind: [
        "{windU} winds in {city}. Everything unsecured is now temporary, {name}.",
        "The wind is taking things. It always takes things. Hold onto what's left, {name}.",
        "{windU}. Somewhere a patio umbrella is achieving flight and ruining someone's afternoon.",
      ],
      extremeHeat: [
        "{tempU} in {city}. We keep saying it's never been this hot, {name}, and we keep being right.",
        "It's {tempU}, feels like {feelsU}. Stay inside. Drink water. Try not to think about August, {name}.",
        "{tempU}. The pavement is soft. So is our collective resolve, {name}.",
      ],
      extremeCold: [
        "{tempU} in {city}. Cold enough that the air feels like it has opinions about you, {name}.",
        "{tempU}. Everything is brittle, including your patience, {name}.",
        "It's {tempU}. The cold gets in through gaps you didn't know you had, {name}.",
      ],
      cold: [
        "{tempU} in {city}. The kind of cold that isn't dramatic, just persistent, {name}. Like most problems.",
        "{tempU}. Grey, damp, unremarkable. It'll be like this for a while, {name}.",
        "Cold again in {city}. Wear the coat. It's the one thing here you can control, {name}.",
      ],
      hot: [
        "{tempU} in {city}. Warm now, warmer later, {name}. That's the whole forecast, really.",
        "It's {tempU}. Sticky, slow, endless. Summer does that, {name}.",
      ],
      clouds: [
        "Total cloud cover over {city}. The sun's up there somewhere, allegedly, {name}.",
        "Grey sky, grey mood, grey day. At least it's consistent, {name}.",
        "Overcast in {city}. No drama, no relief, just a lid on the whole thing, {name}.",
      ],
      clear: [
        "Clear skies over {city}, {tempU}. Enjoy it, {name} — days like this are the exception and they don't wait around.",
        "Not a cloud out there. Go outside, {name}. Genuinely. The good ones are finite.",
        "It's {tempU} and perfect. Which means you'll spend it indoors and remember it in November, {name}.",
      ],
    },
  };

  // Occasional openers to add extra variety (used ~30% of the time).
  const OPENERS = {
    friendly: ['Hey {name}!', 'Good news-ish, {name}:', 'Weather check, {name}:', 'Psst, {name} —'],
    sassy: ['Okay so, {name}...', 'Bulletin for {name}:', 'Deep breath, {name} —', 'Girl. {name}. Listen.'],
    rude: ['Listen up, {name}.', 'Bad news, {name}.', 'Oh great, {name} —', 'Heads up, champ:'],
    brutal: ['Brace yourself, {name}.', 'No sugarcoating this, {name}:', 'Sit down for this one, {name}.', 'Condolences in advance, {name}:'],
    deadpan: ['Weather report, {name}.', 'Facts, {name}:', 'Here it is, {name}.', 'Noted, {name}:'],
    doomer: ['Well, {name}.', 'So, {name} —', 'Here we are, {name}.', 'Anyway, {name}:'],
  };

  // The most recent template id, held in memory rather than storage:
  // it only has to survive from one roast to the next.
  let lastId = null;

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

    // The reset above puts the line that was *just* used back in the
    // running, so without this the bot can say the same thing twice in
    // a row at exactly the moment a pool wraps around. Saying it back
    // to back is the one repeat anybody actually notices.
    if (candidates.length > 1 && lastId) {
      const fresh = candidates.filter((c) => c.id !== lastId);
      if (fresh.length) candidates = fresh;
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    lastId = chosen.id;
    const newHistory = WTWStorage.getRoastHistory();
    newHistory.push(chosen.id);
    WTWStorage.saveRoastHistory(newHistory);
    return chosen.text;
  }

  // Values are converted through units.js so roasts read in whatever
  // system the user picked. Falls back to raw Fahrenheit if units.js
  // is not loaded (e.g. a bare unit test).
  function fill(template, w, name) {
    const U = window.WTWUnits;
    const tempF = w.tempF ?? 0;
    const feelsF = w.feelsLikeF ?? w.tempF ?? 0;
    const windMph = w.windMph ?? 0;

    const tempU  = U ? U.temp(tempF, { withUnit: true })  : `${Math.round(tempF)}°F`;
    const feelsU = U ? U.temp(feelsF, { withUnit: true }) : `${Math.round(feelsF)}°F`;
    const windU  = U ? U.speed(windMph)                   : `${Math.round(windMph)} mph`;
    const tempN  = U ? Math.round(U.tempValue(tempF))     : Math.round(tempF);
    const feelsN = U ? Math.round(U.tempValue(feelsF))    : Math.round(feelsF);
    const windN  = U ? U.speed(windMph, { withUnit: false }) : String(Math.round(windMph));

    return template
      .replaceAll('{name}', name)
      .replaceAll('{city}', w.city || 'your town')
      .replaceAll('{tempU}', tempU)
      .replaceAll('{feelsU}', feelsU)
      .replaceAll('{windU}', windU)
      .replaceAll('{temp}', String(tempN))
      .replaceAll('{feels}', String(feelsN))
      .replaceAll('{wind}', String(windN));
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

  /* ------------------------------------------------------------
     Roast a forecast day rather than current conditions.
     The day's high drives the temperature reaction, so "Saturday"
     gets judged on what Saturday will actually feel like.
     ------------------------------------------------------------ */
  function generateForDay(day, options = {}) {
    if (!day) return generate({}, options);
    const pseudo = {
      city: options.city || '',
      tempF: day.highF ?? day.lowF ?? 70,
      feelsLikeF: day.highF ?? day.lowF ?? 70,
      windMph: options.windMph ?? 5,
      weatherCode: day.code ?? 0,
      precipProb: day.precipProb ?? 0,
    };
    return generate(pseudo, options);
  }

  // Human label for a personality, for use in the UI.
  function label(personality) {
    const p = String(personality || '');
    return p.charAt(0).toUpperCase() + p.slice(1);
  }

  return { generate, generateForDay, detectCategory, label };
})();

window.LocalAI = LocalAI;
