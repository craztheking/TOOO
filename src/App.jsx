import { useState, useEffect, useRef, useCallback } from "react";

// ── Sound Engine ──────────────────────────────────────────────────────────────
const getAudioCtx = (() => {
  let ctx = null;
  return () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
})();
function playTone({ freq=440,type="sine",gain=0.3,duration=0.15,delay=0 }) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator(), vol = ctx.createGain();
    osc.connect(vol); vol.connect(ctx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime+delay);
    vol.gain.setValueAtTime(gain, ctx.currentTime+delay);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+delay+duration);
    osc.start(ctx.currentTime+delay); osc.stop(ctx.currentTime+delay+duration+0.05);
  } catch(e) {}
}
let soundOn = true;
const SFX = {
  confirm:   () => { if(!soundOn) return; playTone({freq:880,gain:0.2,duration:0.08}); playTone({freq:1100,gain:0.15,duration:0.08,delay:0.07}); },
  received:  () => { if(!soundOn) return; [523,659,784].forEach((f,i)=>playTone({freq:f,gain:0.22,duration:0.14,delay:i*0.1})); },
  newRound:  () => { if(!soundOn) return; [392,523,659,784].forEach((f,i)=>playTone({freq:f,type:"triangle",gain:0.28,duration:0.15,delay:i*0.14})); },
  submit:    () => { if(!soundOn) return; playTone({freq:660,gain:0.18,duration:0.1}); },
  tick:      () => { if(!soundOn) return; playTone({freq:1000,type:"square",gain:0.07,duration:0.06}); },
  tickUrgent:() => { if(!soundOn) return; playTone({freq:1400,type:"square",gain:0.12,duration:0.07}); },
  timerEnd:  () => { if(!soundOn) return; [440,330,220].forEach((f,i)=>playTone({freq:f,type:"sawtooth",gain:0.3,duration:0.2,delay:i*0.17})); },
  vote:      () => { if(!soundOn) return; playTone({freq:740,gain:0.2,duration:0.12}); },
  reveal:    () => { if(!soundOn) return; [330,415,523,659,784].forEach((f,i)=>playTone({freq:f,type:"triangle",gain:0.25,duration:0.18,delay:i*0.1})); },
};

// ── Haptic Engine ─────────────────────────────────────────────────────────────
let hapticOn = true;
const HX = {
  tap:     () => { if(hapticOn && navigator.vibrate) navigator.vibrate(10); },
  confirm: () => { if(hapticOn && navigator.vibrate) navigator.vibrate([15,30,15]); },
  success: () => { if(hapticOn && navigator.vibrate) navigator.vibrate([20,40,80]); },
  error:   () => { if(hapticOn && navigator.vibrate) navigator.vibrate([50,30,50,30,50]); },
  timerEnd:() => { if(hapticOn && navigator.vibrate) navigator.vibrate([100,50,100,50,200]); },
};

// ── Text-to-Speech Engine ────────────────────────────────────────────────────
// Uses a single utterance with all answers concatenated — avoids iOS onend bug.
// Each entry is separated by a pause character so the TTS engine breathes between players.
let ttsOn = true;
const TTS = {
  stop: () => {
    try { window.speechSynthesis.cancel(); } catch(e) {}
  },
  // Build one big string and speak it all at once — most reliable cross-browser approach
  readAnswers: (answersObj, players, onDone) => {
    if (!ttsOn) return;
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const parts = Object.entries(answersObj).map(([idx, ans]) => {
        const name = players[+idx]?.name ?? "Player";
        return `${name} said: ${ans}`;
      });
      if (parts.length === 0) return;
      // Join with a long pause marker that TTS engines pause on
      const fullText = parts.join(" ... ");
      const utt = new SpeechSynthesisUtterance(fullText);
      utt.rate = 0.88;
      utt.pitch = 1.0;
      utt.volume = 1.0;
      utt.onend = () => { if (onDone) onDone(); };
      utt.onerror = () => { if (onDone) onDone(); };
      // iOS Safari workaround: voices may not be loaded yet
      const trySpeak = () => {
        const voices = window.speechSynthesis.getVoices();
        // Prefer a local English voice if available
        const preferred = voices.find(v => v.lang.startsWith("en") && v.localService);
        if (preferred) utt.voice = preferred;
        window.speechSynthesis.speak(utt);
      };
      if (window.speechSynthesis.getVoices().length > 0) {
        trySpeak();
      } else {
        window.speechSynthesis.onvoiceschanged = () => { trySpeak(); };
      }
    } catch(e) { if (onDone) onDone(); }
  },
};

// ── Flashlight Engine ─────────────────────────────────────────────────────────
let flashOn = true;
let torchStream = null;
async function getTorchTrack() {
  try {
    if (!torchStream) torchStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const track = torchStream.getVideoTracks()[0];
    if (track?.getCapabilities?.()?.torch) return track;
  } catch(e) {}
  return null;
}
async function flashTorch(times=1, ms=120) {
  if (!flashOn) return;
  const track = await getTorchTrack();
  if (!track) return;
  for (let i=0; i<times; i++) {
    await track.applyConstraints({ advanced: [{ torch: true }] });
    await new Promise(r => setTimeout(r, ms));
    await track.applyConstraints({ advanced: [{ torch: false }] });
    if (i < times-1) await new Promise(r => setTimeout(r, 80));
  }
}

// ── Question Categories ───────────────────────────────────────────────────────
const CATEGORIES = {
  all: { label: "🎲 All", color: "#5C9FE0" },
  food: { label: "🍕 Food & Drink", color: "#E07A5C" },
  popculture: { label: "🎬 Pop Culture", color: "#E05C5C" },
  travel: { label: "✈️ Travel", color: "#5CCE8A" },
  history: { label: "📜 History", color: "#E0C15C" },
  science: { label: "🔬 Science", color: "#5CCEC8" },
  mystery: { label: "🔍 Crime & Mystery", color: "#A05CE0" },
  gaming: { label: "🎮 Video Games", color: "#7AE05C" },
  sport: { label: "🏆 Sport & Fitness", color: "#E0A05C" },
  spicy: { label: "🌶️ Spicy", color: "#E05C8A" },
};


const QUESTION_PAIRS = {
  food: [
    {real:"Describe the perfect pizza.",imposter:"Describe the perfect burger."},
    {real:"What makes a great breakfast?",imposter:"What makes a great dinner?"},
    {real:"Describe your ideal coffee order.",imposter:"Describe your ideal tea order."},
    {real:"What is overrated about sushi?",imposter:"What is overrated about tacos?"},
    {real:"Describe the best chocolate dessert.",imposter:"Describe the best fruit dessert."},
    {real:"What is the best thing about street food?",imposter:"What is the best thing about fine dining?"},
    {real:"How do you make the perfect sandwich?",imposter:"How do you make the perfect salad?"},
    {real:"Describe your favourite comfort food.",imposter:"Describe your favourite guilty pleasure food."},
    {real:"What is the worst thing about fast food?",imposter:"What is the worst thing about health food?"},
    {real:"Describe the perfect barbecue.",imposter:"Describe the perfect picnic."},
    {real:"What makes pasta great?",imposter:"What makes rice great?"},
    {real:"Describe the ideal ice cream flavour.",imposter:"Describe the ideal cake flavour."},
    {real:"What is the best snack for a movie?",imposter:"What is the best snack for a road trip?"},
    {real:"Describe wine in one sentence.",imposter:"Describe beer in one sentence."},
    {real:"What would you eat on a desert island?",imposter:"What would you eat as your last meal?"},
    {real:"What is wrong with pineapple on pizza?",imposter:"What is wrong with anchovies on pizza?"},
    {real:"Describe the smell of fresh bread.",imposter:"Describe the smell of fresh coffee."},
    {real:"What makes a great chef?",imposter:"What makes a great home cook?"},
    {real:"Describe eating something spicy.",imposter:"Describe eating something sour."},
    {real:"What is the best cuisine in the world?",imposter:"What is the most underrated cuisine?"},
    {real:"How do you feel about eating alone?",imposter:"How do you feel about eating with strangers?"},
    {real:"Describe the perfect Sunday roast.",imposter:"Describe the perfect Christmas dinner."},
    {real:"What is the most overpriced food?",imposter:"What is the most underpriced food?"},
    {real:"Describe your relationship with vegetables.",imposter:"Describe your relationship with meat."},
    {real:"What would you serve at your dream dinner party?",imposter:"What would you serve at your dream birthday party?"},
    {real:"What is the best thing about baking?",imposter:"What is the best thing about cooking?"},
    {real:"Describe the perfect steak.",imposter:"Describe the perfect roast chicken."},
    {real:"What is the best condiment ever invented?",imposter:"What is the most useless condiment ever invented?"},
    {real:"How do you feel about spicy food?",imposter:"How do you feel about bitter food?"},
    {real:"Describe a perfect cheese board.",imposter:"Describe a perfect charcuterie board."},
    {real:"What is wrong with diet food?",imposter:"What is wrong with processed food?"},
    {real:"Describe the joy of eating a great dessert.",imposter:"Describe the joy of eating a great starter."},
    {real:"What is the best drink on a hot day?",imposter:"What is the best drink on a cold day?"},
    {real:"Describe your ideal breakfast in bed.",imposter:"Describe your ideal midnight snack."},
    {real:"What makes a great curry?",imposter:"What makes a great stew?"},
    {real:"How do you feel about veganism?",imposter:"How do you feel about vegetarianism?"},
    {real:"Describe the best market food you have eaten.",imposter:"Describe the best restaurant meal you have had."},
    {real:"What is the most satisfying meal to cook?",imposter:"What is the most satisfying meal to order in?"},
    {real:"Describe eating street tacos in Mexico.",imposter:"Describe eating fresh pasta in Italy."},
    {real:"What is the best thing about summer food?",imposter:"What is the best thing about winter food?"},
    {real:"Describe the perfect brunch.",imposter:"Describe the perfect late-night meal."},
    {real:"What food do you refuse to eat?",imposter:"What food do you pretend to like but secretly hate?"},
    {real:"Describe the texture of the perfect steak.",imposter:"Describe the texture of the perfect bread."},
    {real:"What is the best meal to share with someone?",imposter:"What is the best meal to eat completely alone?"},
    {real:"Describe your guilty food pleasure.",imposter:"Describe a food you are embarrassed to love."},
    {real:"What makes a great soup?",imposter:"What makes a great casserole?"},
    {real:"Describe the perfect omelette.",imposter:"Describe the perfect pancake."},
    {real:"What is the best food at a theme park?",imposter:"What is the best food at a sports game?"},
    {real:"How important is presentation in food?",imposter:"How important is portion size in food?"},
    {real:"What is the best hangover food?",imposter:"What is the best food to eat after exercise?"},
    {real:"Describe eating something you have grown yourself.",imposter:"Describe eating something you have caught yourself."},
    {real:"What makes a great noodle dish?",imposter:"What makes a great dumpling?"},
    {real:"Describe the perfect fried chicken.",imposter:"Describe the perfect fish and chips."},
    {real:"What is the best thing about a farmers market?",imposter:"What is the best thing about a supermarket?"},
    {real:"Describe your perfect cheese.",imposter:"Describe your perfect chocolate."},
    {real:"What is the weirdest food combination that actually works?",imposter:"What is the weirdest food combination that definitely does not work?"},
    {real:"Describe the perfect hot sauce.",imposter:"Describe the perfect marinade."},
    {real:"What makes a great taco?",imposter:"What makes a great burrito?"},
    {real:"Describe dining at a Michelin star restaurant.",imposter:"Describe eating at a roadside diner."},
    {real:"What is the most underrated vegetable?",imposter:"What is the most overrated vegetable?"},
    {real:"Describe the perfect Sunday morning fry-up.",imposter:"Describe the perfect Saturday morning pastry."},
    {real:"What is the best thing about ramen?",imposter:"What is the best thing about pho?"},
    {real:"Describe making homemade bread.",imposter:"Describe making homemade pasta."},
    {real:"What is the best midnight snack ever invented?",imposter:"What is the best post-workout snack ever invented?"},
    {real:"Describe your ideal sushi order.",imposter:"Describe your ideal dim sum order."},
    {real:"What is the most controversial food opinion you hold?",imposter:"What is the most unconventional cooking method you would try?"},
    {real:"Describe the perfect smoothie.",imposter:"Describe the perfect juice."},
    {real:"What is the best thing about homemade food?",imposter:"What is the best thing about restaurant food?"},
    {real:"Describe the smell of a perfect barbecue.",imposter:"Describe the smell of a perfect bakery."},
    {real:"What is the most impressive dish to cook for a first date?",imposter:"What is the most impressive dish to cook for parents?"},
    {real:"Describe your perfect pizza topping combination.",imposter:"Describe your perfect pasta sauce combination."},
    {real:"What is the best food to eat when you are sad?",imposter:"What is the best food to eat when you are celebrating?"},
    {real:"Describe the best thing about cheese fondue.",imposter:"Describe the best thing about hot pot."},
    {real:"What makes a great fish dish?",imposter:"What makes a great shellfish dish?"},
    {real:"What is the most comforting smell from childhood food?",imposter:"What is the most vivid taste memory from childhood?"},
    {real:"Describe your perfect lazy Sunday meal.",imposter:"Describe your perfect busy weekday meal."},
    {real:"What would you eat for breakfast if calories did not matter?",imposter:"What would you eat for dinner if money did not matter?"},
    {real:"What is the best way to eat leftovers?",imposter:"What is the best food to meal prep?"},
    {real:"Describe your relationship with takeaways.",imposter:"Describe your relationship with ready meals."},
    {real:"Describe the appeal of eating with chopsticks.",imposter:"Describe the appeal of eating with your hands."},
    {real:"What food trends do you wish would die?",imposter:"What food trends do you wish would come back?"},
    {real:"Describe going to a food festival.",imposter:"Describe going to a wine tasting."},
    {real:"What is the best thing about Japanese food?",imposter:"What is the best thing about Korean food?"},
    {real:"Describe the perfect hot chocolate.",imposter:"Describe the perfect cup of tea."},
    {real:"What would your death row meal be?",imposter:"What would your birthday meal be?"},
    {real:"Describe the experience of learning to cook.",imposter:"Describe the experience of teaching someone to cook."},
    {real:"What is the most nostalgic food from your childhood?",imposter:"What food most reminds you of a specific person?"},
    {real:"Describe the best way to eat a burger.",imposter:"Describe the best way to eat a hot dog."},
    {real:"What is the ultimate comfort food on a rainy day?",imposter:"What is the ultimate refreshing food on a hot day?"},
    {real:"What is the most overrated restaurant experience?",imposter:"What is the most underrated restaurant experience?"},
    {real:"Describe your perfect Christmas breakfast.",imposter:"Describe your perfect New Year Eve snack spread."},
    {real:"What is the best food pairing that sounds wrong but works?",imposter:"What is the worst food pairing that sounds right but does not?"},
    {real:"Describe the perfect gin and tonic.",imposter:"Describe the perfect cocktail."},
    {real:"What makes a great noodle soup?",imposter:"What makes a great broth?"},
    {real:"Describe the experience of eating at a street market abroad.",imposter:"Describe the experience of cooking a dish from another culture."},
    {real:"What is the best food to share at a party?",imposter:"What is the best food to bring to a potluck?"},
    {real:"Describe the perfect fried egg.",imposter:"Describe the perfect scrambled egg."},
    {real:"What is the most satisfying thing to bake from scratch?",imposter:"What is the most satisfying thing to cook from scratch?"},
    {real:"Describe your ideal cheese toastie.",imposter:"Describe your ideal grilled sandwich."},
    {real:"What makes a great chilli?",imposter:"What makes a great Bolognese?"},
  ],
  popculture: [
    {real:"Describe the best superhero movie.",imposter:"Describe the best villain movie."},
    {real:"What makes a great TV show?",imposter:"What makes a great podcast?"},
    {real:"What is overrated about social media?",imposter:"What is overrated about reality TV?"},
    {real:"Describe the best concert experience.",imposter:"Describe the best festival experience."},
    {real:"What makes a song go viral?",imposter:"What makes a meme go viral?"},
    {real:"Describe your favourite movie genre.",imposter:"Describe your favourite music genre."},
    {real:"What is the best thing about streaming services?",imposter:"What is the worst thing about streaming services?"},
    {real:"Describe a perfect Saturday night in.",imposter:"Describe a perfect Saturday night out."},
    {real:"What would your reality TV show be about?",imposter:"What would your YouTube channel be about?"},
    {real:"Describe the best animated movie.",imposter:"Describe the best animated series."},
    {real:"What makes a celebrity annoying?",imposter:"What makes a celebrity likeable?"},
    {real:"Describe the best decade for music.",imposter:"Describe the best decade for movies."},
    {real:"What is the most overrated movie of all time?",imposter:"What is the most underrated movie of all time?"},
    {real:"Describe your relationship with social media.",imposter:"Describe your relationship with the news."},
    {real:"What would you change about Hollywood?",imposter:"What would you change about the music industry?"},
    {real:"What makes a horror movie actually scary?",imposter:"What makes a comedy movie actually funny?"},
    {real:"Describe the best sports moment ever.",imposter:"Describe the best awards show moment ever."},
    {real:"What is the future of television?",imposter:"What is the future of cinema?"},
    {real:"Describe going to the movies.",imposter:"Describe watching something at home."},
    {real:"What is the best thing about celebrity culture?",imposter:"What is the worst thing about celebrity culture?"},
    {real:"Describe your dream collaboration between two artists.",imposter:"Describe your dream crossover between two TV shows."},
    {real:"What is wrong with sequel culture?",imposter:"What is wrong with reboot culture?"},
    {real:"Describe the best video game character.",imposter:"Describe the best movie character."},
    {real:"What makes a great villain in fiction?",imposter:"What makes a great hero in fiction?"},
    {real:"Describe binge-watching a TV series.",imposter:"Describe reading a book series back to back."},
    {real:"What is the best thing about vinyl records?",imposter:"What is the best thing about digital music?"},
    {real:"Describe the impact of TikTok on culture.",imposter:"Describe the impact of Instagram on culture."},
    {real:"What is the most iconic outfit in movie history?",imposter:"What is the most iconic hairstyle in movie history?"},
    {real:"What makes a great documentary?",imposter:"What makes a great biopic?"},
    {real:"Describe the best thing about nostalgia culture.",imposter:"Describe the worst thing about nostalgia culture."},
    {real:"Describe the perfect road trip playlist.",imposter:"Describe the perfect gym playlist."},
    {real:"What is the greatest TV finale of all time?",imposter:"What is the worst TV finale of all time?"},
    {real:"Describe the appeal of reality dating shows.",imposter:"Describe the appeal of competition cooking shows."},
    {real:"What is the best thing about fan culture?",imposter:"What is the worst thing about fan culture?"},
    {real:"Describe your dream movie cast.",imposter:"Describe your dream band lineup."},
    {real:"What makes a great opening scene in a movie?",imposter:"What makes a great opening track on an album?"},
    {real:"Describe how social media changed friendships.",imposter:"Describe how smartphones changed dating."},
    {real:"What is the most influential music video ever?",imposter:"What is the most influential magazine cover ever?"},
    {real:"What would you ask your favourite musician?",imposter:"What would you ask your favourite actor?"},
    {real:"Describe the impact of streaming on music.",imposter:"Describe the impact of streaming on film."},
    {real:"What is the best thing about anime?",imposter:"What is the best thing about manga?"},
    {real:"Describe going to a comedy gig.",imposter:"Describe going to a magic show."},
    {real:"What makes a great book adaptation?",imposter:"What makes a terrible book adaptation?"},
    {real:"Describe the most iconic TV moment of the last decade.",imposter:"Describe the most iconic music moment of the last decade."},
    {real:"What is the most overused trope in movies?",imposter:"What is the most overused trope in TV shows?"},
    {real:"Describe your perfect cinema experience.",imposter:"Describe your perfect home movie night."},
    {real:"What is the best thing about stand-up comedy?",imposter:"What is the best thing about improv comedy?"},
    {real:"Describe the rise of podcasting.",imposter:"Describe the rise of newsletters."},
    {real:"What celebrity passing hit you hardest?",imposter:"What fictional character death hit you hardest?"},
    {real:"Describe the golden age of television.",imposter:"Describe the golden age of cinema."},
    {real:"What is the best soundtrack ever made?",imposter:"What is the best score ever composed for a film?"},
    {real:"What is the most important album of the last 20 years?",imposter:"What is the most important film of the last 20 years?"},
    {real:"Describe the experience of seeing your favourite band live.",imposter:"Describe the experience of meeting a celebrity."},
    {real:"Describe the perfect Netflix binge.",imposter:"Describe the perfect cinema marathon."},
    {real:"What is the most iconic dance move in pop culture?",imposter:"What is the most iconic catchphrase in pop culture?"},
    {real:"Describe how YouTube changed entertainment.",imposter:"Describe how Netflix changed entertainment."},
    {real:"What is the best sitcom of all time?",imposter:"What is the best drama series of all time?"},
    {real:"Describe the appeal of true crime documentaries.",imposter:"Describe the appeal of nature documentaries."},
    {real:"What is the most surprising celebrity comeback?",imposter:"What is the most surprising celebrity downfall?"},
    {real:"What makes a great music album cover?",imposter:"What makes a great movie poster?"},
    {real:"Describe the most controversial music video ever made.",imposter:"Describe the most controversial movie scene ever made."},
    {real:"What is the best cartoon theme song ever written?",imposter:"What is the best TV theme song ever written?"},
    {real:"Describe the experience of discovering a new favourite band.",imposter:"Describe the experience of discovering a new favourite author."},
    {real:"What is the most rewatchable movie ever made?",imposter:"What is the most rereadable book ever written?"},
    {real:"Describe the appeal of celebrity gossip.",imposter:"Describe the appeal of fashion weeks."},
    {real:"Describe going viral on social media.",imposter:"Describe having a song reach number one."},
    {real:"What is the best plot twist in TV history?",imposter:"What is the best plot twist in movie history?"},
    {real:"What is the best thing about comic books?",imposter:"What is the best thing about graphic novels?"},
    {real:"What would the perfect music festival lineup be?",imposter:"What would the perfect TV channel schedule look like?"},
    {real:"Describe the impact of MTV on music.",imposter:"Describe the impact of Spotify on music."},
    {real:"What is the best movie franchise of all time?",imposter:"What is the best TV universe of all time?"},
    {real:"Describe the experience of watching a film in IMAX.",imposter:"Describe the experience of watching a film at a drive-in."},
    {real:"What makes a great awards speech?",imposter:"What makes a great acceptance speech?"},
    {real:"What is the most iconic magazine of all time?",imposter:"What is the most iconic newspaper of all time?"},
    {real:"What is the most quotable movie ever made?",imposter:"What is the most quotable TV show ever made?"},
    {real:"What is the best thing about the Marvel universe?",imposter:"What is the best thing about the DC universe?"},
    {real:"Describe the appeal of late-night talk shows.",imposter:"Describe the appeal of morning talk shows."},
    {real:"What is the best children movie that adults love too?",imposter:"What is the best adult movie that children misunderstand?"},
    {real:"Describe the rise and fall of a one-hit wonder.",imposter:"Describe the rise and fall of a cult TV show."},
    {real:"Describe the best thing about cosplay culture.",imposter:"Describe the best thing about convention culture."},
    {real:"What is the most influential decade for fashion?",imposter:"What is the most influential decade for music?"},
    {real:"What is the biggest cultural moment of the last decade?",imposter:"What is the biggest musical moment of the last decade?"},
    {real:"Describe the experience of watching a Super Bowl halftime show.",imposter:"Describe the experience of watching an Oscars ceremony."},
    {real:"What is the best reality TV elimination ever?",imposter:"What is the best reality TV romance ever?"},
    {real:"Describe the experience of attending a film premiere.",imposter:"Describe the experience of attending a music award ceremony."},
    {real:"What makes a great funniest sketch comedy of all time?",imposter:"What makes a great stand-up special of all time?"},
    {real:"Describe the impact of social media on how music is discovered.",imposter:"Describe the impact of streaming on how films are marketed."},
    {real:"What is the most iconic red carpet moment?",imposter:"What is the most iconic music awards moment?"},
    {real:"Describe the experience of a perfect music video.",imposter:"Describe the experience of a perfect short film."},
    {real:"What is the best thing about mystery box TV shows?",imposter:"What is the best thing about anthology TV shows?"},
    {real:"Describe how cancel culture has changed entertainment.",imposter:"Describe how social movements have changed entertainment."},
    {real:"What is the funniest sitcom moment ever?",imposter:"What is the most dramatic soap opera moment ever?"},
    {real:"Describe the perfect video essay topic.",imposter:"Describe the perfect documentary topic."},
    {real:"What made Friends so iconic?",imposter:"What made The Office so iconic?"},
    {real:"Describe the appeal of watching award shows live.",imposter:"Describe the appeal of watching sporting events live."},
    {real:"What is the best thing about film festivals?",imposter:"What is the best thing about music festivals?"},
    {real:"Describe the most iconic movie monologue ever.",imposter:"Describe the most iconic TV speech ever."},
  ],
  travel: [
    {real:"Describe your ideal beach holiday.",imposter:"Describe your ideal mountain holiday."},
    {real:"What is the worst part about flying?",imposter:"What is the worst part about long car journeys?"},
    {real:"Describe the best city in the world.",imposter:"Describe the best country in the world."},
    {real:"What makes a great hotel?",imposter:"What makes a great hostel?"},
    {real:"Describe travelling solo.",imposter:"Describe travelling with friends."},
    {real:"What is overrated about tourist spots?",imposter:"What is underrated about tourist spots?"},
    {real:"Describe the best travel memory.",imposter:"Describe the worst travel memory."},
    {real:"Describe a perfect road trip.",imposter:"Describe a perfect rail journey."},
    {real:"What is the best thing about European travel?",imposter:"What is the best thing about Asian travel?"},
    {real:"How do you deal with jet lag?",imposter:"How do you deal with travel anxiety?"},
    {real:"Describe staying in an Airbnb.",imposter:"Describe staying in a luxury hotel."},
    {real:"What is the most beautiful natural wonder?",imposter:"What is the most impressive man-made wonder?"},
    {real:"Describe trying local food abroad.",imposter:"Describe trying to speak a foreign language."},
    {real:"What makes a city worth visiting?",imposter:"What makes a country worth visiting?"},
    {real:"Describe the best type of holiday weather.",imposter:"Describe the worst type of holiday weather."},
    {real:"What would your gap year look like?",imposter:"What would your retirement travel look like?"},
    {real:"Describe the experience of getting lost abroad.",imposter:"Describe the experience of missing a flight."},
    {real:"What is the best souvenir you could bring home?",imposter:"What is the worst souvenir you could bring home?"},
    {real:"Describe a safari.",imposter:"Describe a cruise."},
    {real:"What is the appeal of camping?",imposter:"What is the appeal of glamping?"},
    {real:"What do you always forget to pack?",imposter:"What do you always overpack?"},
    {real:"Describe the most underrated travel destination.",imposter:"Describe the most overrated travel destination."},
    {real:"Describe backpacking through Southeast Asia.",imposter:"Describe backpacking through South America."},
    {real:"What is the best thing about travelling alone?",imposter:"What is the hardest thing about travelling alone?"},
    {real:"Describe the airport experience.",imposter:"Describe the train station experience."},
    {real:"Describe your ideal travel companion.",imposter:"Describe your worst possible travel companion."},
    {real:"What is the best thing about budget travel?",imposter:"What is the best thing about luxury travel?"},
    {real:"What makes a great travel photo?",imposter:"What makes a great travel journal entry?"},
    {real:"Describe crossing a border by land.",imposter:"Describe crossing an ocean by ship."},
    {real:"Describe the vibe of a busy Asian night market.",imposter:"Describe the vibe of a quiet European village square."},
    {real:"Describe the perfect city break.",imposter:"Describe the perfect week at the beach."},
    {real:"What is the scariest thing about travelling to a new country?",imposter:"What is the most exciting thing about travelling to a new country?"},
    {real:"Describe travelling during a festival.",imposter:"Describe travelling during a public holiday."},
    {real:"Describe your dream world tour itinerary.",imposter:"Describe your dream journey on the Trans-Siberian railway."},
    {real:"Describe visiting a place that exceeded expectations.",imposter:"Describe visiting a place that disappointed you."},
    {real:"What is the weirdest thing you have eaten abroad?",imposter:"What is the weirdest thing you have seen abroad?"},
    {real:"Describe the difference between a tourist and a traveller.",imposter:"Describe the difference between a backpacker and an expat."},
    {real:"What do you miss most about home when travelling?",imposter:"What do you miss most about travelling when you are home?"},
    {real:"What is the hardest country to travel in?",imposter:"What is the easiest country to travel in?"},
    {real:"Describe island-hopping in Greece.",imposter:"Describe hiking the Camino de Santiago."},
    {real:"What would you pack for a month-long trip?",imposter:"What would you pack for a weekend away?"},
    {real:"Describe the moment you land in a new country.",imposter:"Describe the moment you arrive back home."},
    {real:"Describe the appeal of travelling to cold destinations.",imposter:"Describe the appeal of travelling to tropical destinations."},
    {real:"Describe navigating a city with no internet.",imposter:"Describe navigating a city in a language you do not speak."},
    {real:"What is the most romantic travel destination?",imposter:"What is the most adventure-focused travel destination?"},
    {real:"Describe visiting a war memorial abroad.",imposter:"Describe visiting an ancient ruin abroad."},
    {real:"Describe the perfect spontaneous trip.",imposter:"Describe the perfect meticulously planned trip."},
    {real:"Describe the experience of hitch-hiking.",imposter:"Describe the experience of couchsurfing."},
    {real:"What is the best city for food tourism?",imposter:"What is the best city for art tourism?"},
    {real:"What is the most beautiful sunrise you could witness while travelling?",imposter:"What is the most beautiful sunset you could witness while travelling?"},
    {real:"Describe the experience of staying in a treehouse.",imposter:"Describe the experience of staying in an ice hotel."},
    {real:"What would make a perfect honeymoon destination?",imposter:"What would make a perfect family holiday destination?"},
    {real:"What is the biggest culture shock you could experience?",imposter:"What is the biggest language barrier you could face?"},
    {real:"Describe the experience of seeing the Northern Lights.",imposter:"Describe the experience of seeing a total solar eclipse."},
    {real:"Describe travelling with a toddler.",imposter:"Describe travelling with elderly parents."},
    {real:"Describe visiting Machu Picchu.",imposter:"Describe visiting Angkor Wat."},
    {real:"What is the best night market in Asia?",imposter:"What is the best street market in Europe?"},
    {real:"Describe the experience of white-water rafting abroad.",imposter:"Describe the experience of skydiving abroad."},
    {real:"What is the most important thing to do on your last day in a city?",imposter:"What is the most important thing to do on your first day in a city?"},
    {real:"What is the best thing about travelling in off-season?",imposter:"What is the best thing about travelling during peak season?"},
    {real:"Describe travelling with no itinerary.",imposter:"Describe travelling with a minute-by-minute itinerary."},
    {real:"What is the most romantic city in Europe?",imposter:"What is the most romantic city in Asia?"},
    {real:"Describe wild swimming abroad.",imposter:"Describe wild camping abroad."},
    {real:"Describe the feeling of arriving somewhere new for the first time.",imposter:"Describe the feeling of returning somewhere you love."},
    {real:"What is the most important lesson travel has taught you?",imposter:"What is the most important thing travel has changed about you?"},
    {real:"What is the best thing about long-haul flights?",imposter:"What is the worst thing about long-haul flights?"},
    {real:"What is the best travel hack you know?",imposter:"What is the worst travel mistake anyone makes?"},
    {real:"Describe travelling across America by car.",imposter:"Describe travelling across Australia by campervan."},
    {real:"What is the most photogenic country in the world?",imposter:"What is the most underrated photogenic country?"},
    {real:"Describe visiting a floating market.",imposter:"Describe visiting a desert bazaar."},
    {real:"Describe visiting Disneyland as an adult.",imposter:"Describe visiting a theme park for the first time."},
    {real:"What is the most unique accommodation you could stay in?",imposter:"What is the strangest place you could sleep while travelling?"},
    {real:"Describe the best train journey in the world.",imposter:"Describe the best ferry journey in the world."},
    {real:"What would make you move to another country permanently?",imposter:"What would make you return home after years abroad?"},
    {real:"What is the best city to be young in?",imposter:"What is the best city to grow old in?"},
    {real:"Describe attending a local event in a foreign country.",imposter:"Describe getting invited to a local home abroad."},
    {real:"Describe the experience of visiting a place you read about in a book.",imposter:"Describe the experience of visiting a place you saw in a movie."},
    {real:"Describe what you would do on a layover in Tokyo.",imposter:"Describe what you would do on a layover in Dubai."},
    {real:"What is the best thing about inter-railing?",imposter:"What is the best thing about a round-the-world ticket?"},
    {real:"What is the most important thing to research before visiting a new country?",imposter:"What is the most important thing to buy before a long trip?"},
    {real:"What is the most beautiful temple you could visit?",imposter:"What is the most beautiful mosque you could visit?"},
    {real:"Describe the most beautiful coastline you can imagine.",imposter:"Describe the most beautiful mountain range you can imagine."},
    {real:"What is the best thing to bring back from Japan?",imposter:"What is the best thing to bring back from France?"},
    {real:"Describe arriving in a country with no plan.",imposter:"Describe arriving somewhere completely alone for the first time."},
    {real:"What makes a perfect boutique hotel?",imposter:"What makes a perfect hostel?"},
    {real:"Describe the experience of travelling at Christmas.",imposter:"Describe the experience of travelling on your birthday."},
    {real:"What is the most you have ever spent on a hotel night?",imposter:"What is the least you have ever spent on accommodation?"},
    {real:"Describe the most chaotic travel experience imaginable.",imposter:"Describe the most peaceful travel experience imaginable."},
    {real:"What is the best thing about travelling in your 20s?",imposter:"What is the best thing about travelling in your 40s?"},
  ],
  history: [
    {real:"Describe the most important invention in history.",imposter:"Describe the most destructive invention in history."},
    {real:"What was the best era to live in?",imposter:"What was the worst era to live in?"},
    {real:"Describe what life was like in ancient Rome.",imposter:"Describe what life was like in ancient Egypt."},
    {real:"Who was the greatest leader in history?",imposter:"Who was the most dangerous leader in history?"},
    {real:"Describe the impact of the printing press.",imposter:"Describe the impact of the internet on society."},
    {real:"What caused the fall of the Roman Empire?",imposter:"What caused the fall of the British Empire?"},
    {real:"Describe the French Revolution in one sentence.",imposter:"Describe the American Revolution in one sentence."},
    {real:"What was the most significant battle in history?",imposter:"What was the most pointless war in history?"},
    {real:"Describe life during World War II.",imposter:"Describe life during the Cold War."},
    {real:"Who deserves more credit in history?",imposter:"Who deserves more blame in history?"},
    {real:"What would you change about the 20th century?",imposter:"What would you change about the 21st century?"},
    {real:"Describe the space race.",imposter:"Describe the arms race."},
    {real:"What is the most important moment in civil rights history?",imposter:"What is the most important moment in women history?"},
    {real:"Describe the Renaissance.",imposter:"Describe the Industrial Revolution."},
    {real:"What historical mystery do you most want solved?",imposter:"What historical conspiracy theory fascinates you most?"},
    {real:"Describe the impact of Alexander the Great.",imposter:"Describe the impact of Napoleon."},
    {real:"What would a medieval peasant think of modern life?",imposter:"What would a Victorian think of modern life?"},
    {real:"What was the most underrated historical event?",imposter:"What was the most overrated historical event?"},
    {real:"Describe the impact of the Black Death.",imposter:"Describe the impact of the 1918 flu pandemic."},
    {real:"Who was the most fascinating historical villain?",imposter:"Who was the most fascinating historical hero?"},
    {real:"Describe ancient Greek democracy.",imposter:"Describe ancient Roman law."},
    {real:"What would you ask Julius Caesar?",imposter:"What would you ask Cleopatra?"},
    {real:"Describe the fall of the Berlin Wall.",imposter:"Describe the fall of the Soviet Union."},
    {real:"What does history teach us about human nature?",imposter:"What does history teach us about power?"},
    {real:"Describe the Viking Age.",imposter:"Describe the Age of Exploration."},
    {real:"What was the biggest mistake of the 20th century?",imposter:"What was the greatest achievement of the 20th century?"},
    {real:"What would the world look like if WW2 had a different outcome?",imposter:"What would the world look like if the Roman Empire never fell?"},
    {real:"Describe the significance of the Silk Road.",imposter:"Describe the significance of the Spice Trade."},
    {real:"Who was the most effective revolutionary in history?",imposter:"Who was the most effective reformer in history?"},
    {real:"Describe a day in the life of a Roman soldier.",imposter:"Describe a day in the life of a medieval knight."},
    {real:"What was the most pivotal year in the 20th century?",imposter:"What was the most pivotal year in the 19th century?"},
    {real:"Describe the causes of World War I.",imposter:"Describe the causes of World War II."},
    {real:"What is the most important treaty ever signed?",imposter:"What is the most important document ever written?"},
    {real:"Describe the colonisation of the Americas.",imposter:"Describe the colonisation of Africa."},
    {real:"Describe the impact of the steam engine.",imposter:"Describe the impact of electricity on society."},
    {real:"Who was the greatest military strategist in history?",imposter:"Who was the greatest political strategist in history?"},
    {real:"Describe life in ancient Athens.",imposter:"Describe life in ancient Sparta."},
    {real:"What is the most important scientific discovery in history?",imposter:"What is the most important medical discovery in history?"},
    {real:"What was the most significant social movement in history?",imposter:"What was the most significant political movement in history?"},
    {real:"Describe the impact of the moon landing.",imposter:"Describe the impact of splitting the atom."},
    {real:"Who made the biggest sacrifice in history?",imposter:"Who caused the biggest suffering in history?"},
    {real:"Describe the origins of democracy.",imposter:"Describe the origins of capitalism."},
    {real:"What historical period had the best art?",imposter:"What historical period had the best architecture?"},
    {real:"Describe how the Roman roads changed the ancient world.",imposter:"Describe how the railways changed the modern world."},
    {real:"What is the most tragic story in history?",imposter:"What is the most inspiring story in history?"},
    {real:"Describe the impact of the theory of evolution.",imposter:"Describe the impact of the theory of relativity."},
    {real:"Describe the last days of the Roman Empire.",imposter:"Describe the last days of the Ottoman Empire."},
    {real:"What was life like for a woman in the Victorian era?",imposter:"What was life like for a woman in the Tudor era?"},
    {real:"Describe the building of the Great Wall of China.",imposter:"Describe the building of the Egyptian pyramids."},
    {real:"What was the most brutal empire in history?",imposter:"What was the most enlightened empire in history?"},
    {real:"Describe the role of propaganda in World War II.",imposter:"Describe the role of propaganda in the Cold War."},
    {real:"Who was the most influential philosopher in history?",imposter:"Who was the most influential scientist in history?"},
    {real:"Describe the fall of Constantinople.",imposter:"Describe the fall of Jerusalem during the Crusades."},
    {real:"What was the most surprising alliance in history?",imposter:"What was the most unexpected betrayal in history?"},
    {real:"What would history look like if the Library of Alexandria had survived?",imposter:"What would history look like if the plague had not hit Europe?"},
    {real:"What is the most misunderstood historical event?",imposter:"What is the most romanticised historical event?"},
    {real:"What role did religion play in ancient Rome?",imposter:"What role did religion play in medieval Europe?"},
    {real:"What was the most important invention of the 19th century?",imposter:"What was the most important invention of the 20th century?"},
    {real:"Describe the experience of being a spy in World War II.",imposter:"Describe the experience of being a spy in the Cold War."},
    {real:"What would you change about how history is taught in schools?",imposter:"What historical story is most important for children to learn?"},
    {real:"Describe the most dramatic royal scandal in history.",imposter:"Describe the most dramatic political scandal in history."},
    {real:"What was the most significant naval battle in history?",imposter:"What was the most significant aerial battle in history?"},
    {real:"Describe the impact of gunpowder on warfare.",imposter:"Describe the impact of the nuclear bomb on warfare."},
    {real:"What historical figure would you most want to have dinner with?",imposter:"What historical figure would you least want to meet?"},
    {real:"What was the most important social reform of the 20th century?",imposter:"What was the most important legal reform of the 20th century?"},
    {real:"Describe the impact of the abolition of slavery.",imposter:"Describe the impact of the suffragette movement."},
    {real:"What was the greatest act of resistance in history?",imposter:"What was the greatest act of courage in history?"},
    {real:"Describe crossing the Atlantic on the Titanic.",imposter:"Describe being on the first moon landing crew."},
    {real:"What drove the rise of fascism in the 1930s?",imposter:"What drove the rise of communism in the early 20th century?"},
    {real:"Describe the most significant peace agreement in history.",imposter:"Describe the most significant ceasefire in history."},
    {real:"What would ancient Romans think of modern cities?",imposter:"What would ancient Egyptians think of modern technology?"},
    {real:"Describe living through the Great Depression.",imposter:"Describe living through the 2008 financial crisis."},
    {real:"What was the most important act of civil disobedience in history?",imposter:"What was the most important protest in history?"},
    {real:"Describe the impact of the Enlightenment.",imposter:"Describe the impact of the Reformation."},
    {real:"What was the most devastating natural disaster in history?",imposter:"What was the most devastating famine in history?"},
    {real:"Describe how the world changed after 9/11.",imposter:"Describe how the world changed after the fall of the Berlin Wall."},
    {real:"What drove the Viking expansion?",imposter:"What drove the Mongol expansion?"},
    {real:"Describe the role of art in propaganda throughout history.",imposter:"Describe the role of music in revolution throughout history."},
    {real:"What was the most surprising outcome of a historical election?",imposter:"What was the most surprising outcome of a historical referendum?"},
    {real:"Describe the impact of the Suez Crisis.",imposter:"Describe the impact of the Cuban Missile Crisis."},
    {real:"Describe how the world changed after the invention of electricity.",imposter:"Describe how the world changed after the invention of the car."},
    {real:"Describe the Crusades in one paragraph.",imposter:"Describe the Mongol Empire in one paragraph."},
    {real:"What is the most interesting thing about the Byzantine Empire?",imposter:"What is the most interesting thing about the Persian Empire?"},
    {real:"What lesson from ancient civilisations is most relevant today?",imposter:"What mistake from ancient civilisations are we still repeating?"},
    {real:"Describe the most significant archaeological discovery ever.",imposter:"Describe the most significant geological discovery ever."},
    {real:"What was the most important trade route in history?",imposter:"What was the most important migration in history?"},
    {real:"Describe the impact of the discovery of the Americas.",imposter:"Describe the impact of the discovery of Australia."},
    {real:"Describe the experience of being a prisoner of war.",imposter:"Describe the experience of being a refugee in wartime."},
    {real:"What was the most important concept from the Age of Enlightenment?",imposter:"What was the most important concept from the Scientific Revolution?"},
    {real:"Describe the most dramatic political assassination in history.",imposter:"Describe the most dramatic revolution in history."},
    {real:"What is the most debated historical question of all time?",imposter:"What is the most revised historical interpretation of all time?"},
    {real:"Describe what would have happened had Hitler been accepted to art school.",imposter:"Describe what would have happened had the Cuban Missile Crisis escalated."},
    {real:"What drove people to colonise new continents?",imposter:"What drove people to build empires?"},
    {real:"Who was the most fascinating historical figure you have never heard of?",imposter:"Who is the most overrated figure in history?"},
    {real:"Describe the experience of immigrating to a new country in the 1800s.",imposter:"Describe the experience of emigrating from Europe during the World Wars."},
    {real:"What would you ask someone who lived through the Great Fire of London?",imposter:"What would you ask someone who lived through the Blitz?"},
  ],
  science: [
    {real:"Describe how black holes work.",imposter:"Describe how neutron stars work."},
    {real:"What is the most impressive thing about the human brain?",imposter:"What is the most impressive thing about the human immune system?"},
    {real:"Describe the theory of evolution.",imposter:"Describe the theory of natural selection."},
    {real:"What is the biggest unsolved problem in physics?",imposter:"What is the biggest unsolved problem in biology?"},
    {real:"Describe climate change in simple terms.",imposter:"Describe ocean acidification in simple terms."},
    {real:"What makes artificial intelligence dangerous?",imposter:"What makes artificial intelligence exciting?"},
    {real:"Describe the discovery of DNA.",imposter:"Describe the discovery of penicillin."},
    {real:"What would happen if we found alien life?",imposter:"What would happen if we found a second Earth?"},
    {real:"Describe quantum mechanics to a five-year-old.",imposter:"Describe relativity to a five-year-old."},
    {real:"What is the most dangerous experiment in history?",imposter:"What is the most important experiment in history?"},
    {real:"Describe the Big Bang.",imposter:"Describe the heat death of the universe."},
    {real:"What is the most impressive animal adaptation?",imposter:"What is the strangest animal adaptation?"},
    {real:"Describe CRISPR gene editing.",imposter:"Describe stem cell therapy."},
    {real:"What is the future of space exploration?",imposter:"What is the future of deep sea exploration?"},
    {real:"Describe how vaccines work.",imposter:"Describe how antibiotics work."},
    {real:"What would a world without gravity be like?",imposter:"What would a world without oxygen be like?"},
    {real:"Describe the largest structure in the universe.",imposter:"Describe the smallest known particle."},
    {real:"What is the most mind-bending fact about time?",imposter:"What is the most mind-bending fact about space?"},
    {real:"Describe the impact of the Hubble telescope.",imposter:"Describe the impact of the James Webb telescope."},
    {real:"Describe how the internet actually works.",imposter:"Describe how GPS actually works."},
    {real:"What is the most exciting recent scientific discovery?",imposter:"What is the most controversial scientific theory?"},
    {real:"Describe life on Mars.",imposter:"Describe life on Europa."},
    {real:"What is the ethical problem with cloning?",imposter:"What is the ethical problem with genetic modification?"},
    {real:"Describe the speed of light.",imposter:"Describe the speed of sound."},
    {real:"What is the most complex organ in the human body?",imposter:"What is the most underrated organ in the human body?"},
    {real:"Describe the water cycle.",imposter:"Describe the carbon cycle."},
    {real:"What would happen if the moon disappeared?",imposter:"What would happen if the sun became 10 percent hotter?"},
    {real:"Describe the Large Hadron Collider.",imposter:"Describe the International Space Station."},
    {real:"What is the hardest material in the universe?",imposter:"What is the rarest element in the universe?"},
    {real:"Describe how a star is born.",imposter:"Describe how a star dies."},
    {real:"What is the difference between a virus and a bacterium?",imposter:"What is the difference between a cell and an atom?"},
    {real:"Describe the potential of fusion energy.",imposter:"Describe the potential of solar energy."},
    {real:"What is the most dangerous chemical reaction?",imposter:"What is the most useful chemical reaction?"},
    {real:"Describe the theory of multiple universes.",imposter:"Describe the simulation theory."},
    {real:"Describe the human genome project.",imposter:"Describe the Mars rover mission."},
    {real:"What would you ask an alien civilisation?",imposter:"What would you show an alien civilisation about Earth?"},
    {real:"Describe the impact of plastics on the ocean.",imposter:"Describe the impact of CO2 on the atmosphere."},
    {real:"What is the most mind-blowing number in mathematics?",imposter:"What is the most beautiful equation in mathematics?"},
    {real:"Describe how memory works in the human brain.",imposter:"Describe how dreams work in the human brain."},
    {real:"What is the biggest threat to biodiversity?",imposter:"What is the biggest threat to the ocean?"},
    {real:"Describe the discovery of the Higgs boson.",imposter:"Describe the discovery of gravitational waves."},
    {real:"What is the most surprising thing about deep sea creatures?",imposter:"What is the most surprising thing about creatures in extreme environments?"},
    {real:"Describe how evolution created the human eye.",imposter:"Describe how evolution created the human hand."},
    {real:"What would happen if we could stop ageing?",imposter:"What would happen if we could download the human brain?"},
    {real:"Describe the science behind earthquakes.",imposter:"Describe the science behind hurricanes."},
    {real:"What is the most profound unanswered question in cosmology?",imposter:"What is the most profound unanswered question in neuroscience?"},
    {real:"Describe tectonic plates and how they move.",imposter:"Describe ocean currents and how they flow."},
    {real:"What is the most elegant solution in mathematics?",imposter:"What is the most elegant solution in physics?"},
    {real:"Describe the role of mitochondria.",imposter:"Describe the role of ribosomes."},
    {real:"What would a world with two suns be like?",imposter:"What would a world with two moons be like?"},
    {real:"Describe how CRISPR could cure diseases.",imposter:"Describe how AI could revolutionise medicine."},
    {real:"What is the most surprising fact about the human skeleton?",imposter:"What is the most surprising fact about the human nervous system?"},
    {real:"Describe the experience of weightlessness in space.",imposter:"Describe the experience of extreme pressure at the bottom of the ocean."},
    {real:"What would happen if we ran out of fresh water?",imposter:"What would happen if we ran out of fossil fuels tomorrow?"},
    {real:"Describe how the ozone layer protects us.",imposter:"Describe how the magnetic field protects us."},
    {real:"What is the most impressive thing a supercomputer can do?",imposter:"What is the most impressive thing a quantum computer can do?"},
    {real:"What is the most important thing we have learned from studying apes?",imposter:"What is the most important thing we have learned from studying dolphins?"},
    {real:"Describe how photosynthesis works.",imposter:"Describe how cellular respiration works."},
    {real:"What is the most complex system in the natural world?",imposter:"What is the most efficient system in the natural world?"},
    {real:"Describe the science of sleep.",imposter:"Describe the science of dreams."},
    {real:"What would happen if we could teleport?",imposter:"What would happen if we could time travel?"},
    {real:"Describe the impact of antibiotic resistance.",imposter:"Describe the impact of vaccine hesitancy."},
    {real:"What is the most promising renewable energy source?",imposter:"What is the most controversial energy source?"},
    {real:"Describe how the human eye processes colour.",imposter:"Describe how the human ear processes sound."},
    {real:"What is the most extreme environment life has been found in?",imposter:"What is the most hostile environment humans have explored?"},
    {real:"Describe the science of addiction.",imposter:"Describe the science of habit formation."},
    {real:"What would happen if we colonised Mars?",imposter:"What would happen if we colonised the Moon?"},
    {real:"Describe how coral reefs work.",imposter:"Describe how rainforests work."},
    {real:"What is the most important thing we do not understand about the universe?",imposter:"What is the most important thing we do not understand about the human mind?"},
    {real:"Describe how viruses mutate.",imposter:"Describe how bacteria develop resistance."},
    {real:"What is the most terrifying fact about the sun?",imposter:"What is the most terrifying fact about black holes?"},
    {real:"Describe the science of ageing.",imposter:"Describe the science of regeneration in animals."},
    {real:"What would the world look like in 1000 years based on current science?",imposter:"What would the world look like in 100 years based on current trends?"},
    {real:"Describe how dark matter affects galaxies.",imposter:"Describe how dark energy affects the universe."},
    {real:"What is the most important thing to know about nuclear fusion?",imposter:"What is the most important thing to know about nuclear fission?"},
    {real:"Describe the science of pain.",imposter:"Describe the science of pleasure."},
    {real:"Describe how a computer chip works.",imposter:"Describe how a neural network works."},
    {real:"What is the most promising treatment for cancer?",imposter:"What is the most promising treatment for Alzheimers?"},
    {real:"Describe the science behind lightning.",imposter:"Describe the science behind auroras."},
    {real:"What is the most surprising thing found at the bottom of the ocean?",imposter:"What is the most surprising thing found in outer space?"},
    {real:"Describe the role of gut bacteria in human health.",imposter:"Describe the role of the microbiome in mental health."},
    {real:"Describe the most impressive animal intelligence we have discovered.",imposter:"Describe the most impressive plant behaviour we have discovered."},
    {real:"What is the most difficult mathematical problem ever solved?",imposter:"What is the most difficult mathematical problem yet unsolved?"},
    {real:"Describe the science of consciousness.",imposter:"Describe the science of self-awareness."},
    {real:"What is the most important environmental tipping point?",imposter:"What is the most important climate feedback loop?"},
    {real:"Describe how mRNA vaccines work.",imposter:"Describe how gene therapy works."},
    {real:"What would a world without microbes look like?",imposter:"What would a world without insects look like?"},
    {real:"Describe the most mind-bending paradox in physics.",imposter:"Describe the most mind-bending paradox in mathematics."},
    {real:"Describe how the James Webb telescope is changing our understanding of the universe.",imposter:"Describe how the Large Hadron Collider is changing our understanding of matter."},
    {real:"What is the most counterintuitive result in quantum physics?",imposter:"What is the most counterintuitive result in cosmology?"},
    {real:"Describe the science of how the Moon affects Earth.",imposter:"Describe the science of how the Sun affects Earth."},
    {real:"What is the most important thing we have learned from the Apollo missions?",imposter:"What is the most important thing we have learned from the Mars rovers?"},
    {real:"Describe the most impressive feat of bioengineering.",imposter:"Describe the most impressive feat of nanotechnology."},
    {real:"What is the most important unsolved question in genetics?",imposter:"What is the most important unsolved question in evolutionary biology?"},
    {real:"Describe the experience of being an astronaut on the ISS.",imposter:"Describe the experience of being a scientist at an Antarctic research station."},
    {real:"What is the most incredible feat of human engineering?",imposter:"What is the most incredible feat of natural engineering?"},
    {real:"Describe the most mind-blowing result in quantum entanglement.",imposter:"Describe the most mind-blowing result in string theory."},
    {real:"What is the most important discovery in particle physics?",imposter:"What is the most important discovery in astrophysics?"},
  ],
  mystery: [
    {real:"Describe the perfect murder mystery.",imposter:"Describe the perfect heist story."},
    {real:"What makes a great detective?",imposter:"What makes a great criminal mastermind?"},
    {real:"Describe the most famous unsolved crime.",imposter:"Describe the most famous wrongful conviction."},
    {real:"What is more fascinating, serial killers or cults?",imposter:"What is more fascinating, cold cases or missing persons?"},
    {real:"Describe the best true crime podcast.",imposter:"Describe the best crime documentary."},
    {real:"What would you do if you witnessed a crime?",imposter:"What would you do if you were accused of a crime?"},
    {real:"Describe the perfect alibi.",imposter:"Describe the perfect getaway."},
    {real:"What makes forensic science so powerful?",imposter:"What makes eyewitness testimony so unreliable?"},
    {real:"Describe the Zodiac Killer case.",imposter:"Describe the Jack the Ripper case."},
    {real:"What is the scariest conspiracy theory?",imposter:"What is the most believable conspiracy theory?"},
    {real:"Describe life in prison.",imposter:"Describe life on death row."},
    {real:"What would you steal if you could get away with it?",imposter:"What would you hack if you could get away with it?"},
    {real:"Describe the best Agatha Christie novel.",imposter:"Describe the best Sherlock Holmes story."},
    {real:"What makes a cold case impossible to solve?",imposter:"What makes a cold case suddenly solvable?"},
    {real:"Describe the most audacious bank robbery.",imposter:"Describe the most audacious art theft."},
    {real:"What is the most corrupt institution?",imposter:"What is the most secretive institution?"},
    {real:"What drives someone to commit murder?",imposter:"What drives someone to commit fraud?"},
    {real:"Describe the dark web.",imposter:"Describe organised crime."},
    {real:"What is the biggest flaw in the justice system?",imposter:"What is the biggest flaw in the prison system?"},
    {real:"Describe being on a jury.",imposter:"Describe being a witness in court."},
    {real:"What historical crime would you solve?",imposter:"What historical injustice would you overturn?"},
    {real:"Describe the appeal of crime fiction.",imposter:"Describe the appeal of true crime."},
    {real:"What makes someone a con artist?",imposter:"What makes someone a fraudster?"},
    {real:"Describe the most elaborate scam ever.",imposter:"Describe the most elaborate cover-up ever."},
    {real:"What is the most baffling unsolved disappearance?",imposter:"What is the most baffling unsolved plane crash?"},
    {real:"Describe how forensic DNA evidence changed criminal justice.",imposter:"Describe how CCTV changed criminal justice."},
    {real:"What is the most ingenious prison escape?",imposter:"What is the most daring undercover police operation?"},
    {real:"Describe the psychology of a cult leader.",imposter:"Describe the psychology of a con artist."},
    {real:"What is the most compelling evidence in a cold case?",imposter:"What is the most common mistake criminals make?"},
    {real:"Describe the role of a criminal profiler.",imposter:"Describe the role of a forensic pathologist."},
    {real:"What would you do if you found evidence of a crime?",imposter:"What would you do if you were wrongly convicted?"},
    {real:"What makes a great courtroom drama?",imposter:"What makes a great heist film?"},
    {real:"Describe how money laundering works.",imposter:"Describe how identity theft works."},
    {real:"What is the most notorious criminal trial in history?",imposter:"What is the most controversial criminal verdict in history?"},
    {real:"What would your perfect crime be?",imposter:"What would your perfect escape plan be?"},
    {real:"Describe how the Mafia operates.",imposter:"Describe how a drug cartel operates."},
    {real:"What is the most chilling unsolved murder?",imposter:"What is the most chilling unsolved robbery?"},
    {real:"What is the difference between manslaughter and murder?",imposter:"What is the difference between theft and fraud?"},
    {real:"Describe the most incredible heist in history.",imposter:"Describe the most incredible con in history."},
    {real:"What role does luck play in getting away with a crime?",imposter:"What role does arrogance play in getting caught?"},
    {real:"Describe how a murderer covers their tracks.",imposter:"Describe how a thief covers their tracks."},
    {real:"What is the most shocking true crime case of the century?",imposter:"What is the most shocking miscarriage of justice of the century?"},
    {real:"Describe how white-collar crime destroys lives.",imposter:"Describe how cybercrime destroys lives."},
    {real:"What would make you turn to a life of crime?",imposter:"What would make you turn someone in to the police?"},
    {real:"Describe solving a crime using only social media.",imposter:"Describe solving a crime using only CCTV footage."},
    {real:"What is the most chilling thing about serial killers?",imposter:"What is the most chilling thing about cults?"},
    {real:"Describe the work of a cold case detective.",imposter:"Describe the work of a forensic accountant."},
    {real:"What is the best fictional detective of all time?",imposter:"What is the best fictional criminal of all time?"},
    {real:"Describe the experience of interviewing a suspect.",imposter:"Describe the experience of testifying in court."},
    {real:"What is the most dangerous job in law enforcement?",imposter:"What is the most dangerous job in the legal system?"},
    {real:"Describe the most elaborate fraud scheme in history.",imposter:"Describe the most elaborate drug smuggling operation in history."},
    {real:"What is the most difficult crime to investigate?",imposter:"What is the most difficult crime to prosecute?"},
    {real:"What is the most impressive piece of forensic evidence ever found?",imposter:"What is the most surprising piece of evidence that solved a case?"},
    {real:"Describe the experience of being an undercover police officer.",imposter:"Describe the experience of being in witness protection."},
    {real:"What is the most sophisticated cyber attack in history?",imposter:"What is the most sophisticated financial crime in history?"},
    {real:"Describe the experience of being held hostage.",imposter:"Describe the experience of being falsely imprisoned."},
    {real:"What makes someone cross the line from petty crime to serious crime?",imposter:"What makes someone become a repeat offender?"},
    {real:"What is the most surprising motive for murder ever revealed?",imposter:"What is the most surprising motive for theft ever revealed?"},
    {real:"Describe the life of a crime scene investigator.",imposter:"Describe the life of a homicide detective."},
    {real:"What would make the perfect locked-room mystery?",imposter:"What would make the perfect unsolvable cold case?"},
    {real:"What is the most sophisticated surveillance method ever used?",imposter:"What is the most sophisticated tracking method ever used?"},
    {real:"What is the most shocking thing ever found at a crime scene?",imposter:"What is the most unexpected piece of evidence that solved a case?"},
    {real:"Describe how criminals use cryptocurrency.",imposter:"Describe how criminals use the dark web."},
    {real:"What is the most interesting alibi ever given in court?",imposter:"What is the most creative defence ever used in a criminal trial?"},
    {real:"What is the most effective interrogation technique?",imposter:"What is the most controversial interrogation technique?"},
    {real:"What is the most important lesson from the OJ Simpson trial?",imposter:"What is the most important lesson from the Amanda Knox case?"},
    {real:"Describe being exonerated after wrongful conviction.",imposter:"Describe having your conviction overturned on appeal."},
    {real:"What role does the media play in criminal cases?",imposter:"What role does social media play in modern criminal investigations?"},
    {real:"Describe the most sophisticated art forgery ever discovered.",imposter:"Describe the most sophisticated antique fraud ever discovered."},
    {real:"Describe how gang culture develops.",imposter:"Describe how cult mentality develops."},
    {real:"What is the most famous unsolved disappearance in history?",imposter:"What is the most famous unsolved murder in history?"},
    {real:"Describe how forensic linguistics helps solve crimes.",imposter:"Describe how forensic psychology helps solve crimes."},
    {real:"What is the most dangerous prison in the world?",imposter:"What is the most controversial prison system in the world?"},
    {real:"Describe how a criminal builds a false identity.",imposter:"Describe how a criminal builds a false alibi."},
    {real:"Describe the science of blood spatter analysis.",imposter:"Describe the science of digital forensics."},
    {real:"Describe the most audacious jewellery heist ever.",imposter:"Describe the most audacious museum theft ever."},
    {real:"What would the perfect witness protection identity look like?",imposter:"What would the perfect undercover identity look like?"},
    {real:"Describe the experience of tracking a fugitive.",imposter:"Describe the experience of hunting a missing person."},
    {real:"Describe the most elaborate ransom demand ever made.",imposter:"Describe the most elaborate blackmail scheme ever uncovered."},
    {real:"Describe the experience of profiling a serial killer.",imposter:"Describe the experience of negotiating with a hostage taker."},
    {real:"What is the biggest unsolved bank robbery in history?",imposter:"What is the biggest unsolved art theft in history?"},
    {real:"Describe the impact of fingerprint technology on criminal justice.",imposter:"Describe the impact of facial recognition on criminal justice."},
    {real:"What is the most terrifying thing about organised crime?",imposter:"What is the most terrifying thing about white-collar crime?"},
    {real:"Describe what makes a criminal trial compelling viewing.",imposter:"Describe what makes a crime novel unputdownable."},
    {real:"Describe the most infamous pirate in history.",imposter:"Describe the most infamous highwayman in history."},
    {real:"What is the most shocking twist in a real criminal case?",imposter:"What is the most shocking twist in a fictional crime story?"},
    {real:"What is the biggest unsolved mystery of the last 50 years?",imposter:"What is the biggest criminal conspiracy of the last 50 years?"},
    {real:"Describe the psychology of someone who commits insurance fraud.",imposter:"Describe the psychology of someone who commits tax evasion."},
    {real:"Describe the most dangerous neighbourhood in criminal history.",imposter:"Describe the most dangerous criminal organisation in history."},
    {real:"What is the most chilling true crime book ever written?",imposter:"What is the most chilling true crime documentary ever made?"},
    {real:"Describe the most disturbing criminal psychology study ever conducted.",imposter:"Describe the most disturbing criminal behaviour pattern ever identified."},
    {real:"What is the best fictional crime writer of all time?",imposter:"What is the best real crime journalist of all time?"},
    {real:"Describe the experience of sitting on a jury for a murder trial.",imposter:"Describe the experience of being a juror in a high-profile fraud case."},
    {real:"Describe what led to the rise of organised crime in the 1920s.",imposter:"Describe what led to the rise of cybercrime in the 2000s."},
    {real:"What would you change about the criminal justice system?",imposter:"What would you change about the prison system?"},
  ],
  gaming: [
    {real:"Describe your all-time favourite video game.",imposter:"Describe your all-time favourite board game."},
    {real:"What makes a great open world game?",imposter:"What makes a great linear story game?"},
    {real:"Describe the best boss fight you have ever experienced.",imposter:"Describe the hardest puzzle you have ever solved in a game."},
    {real:"What is the best gaming console ever made?",imposter:"What is the best gaming handheld ever made?"},
    {real:"Describe the perfect multiplayer experience.",imposter:"Describe the perfect single-player experience."},
    {real:"What makes a great RPG?",imposter:"What makes a great strategy game?"},
    {real:"Describe the most emotional moment you have had in a video game.",imposter:"Describe the most surprising plot twist you have experienced in a game."},
    {real:"What is overrated about battle royale games?",imposter:"What is overrated about first-person shooters?"},
    {real:"Describe the best video game soundtrack ever.",imposter:"Describe the best video game art direction ever."},
    {real:"What makes a great villain in a video game?",imposter:"What makes a great protagonist in a video game?"},
    {real:"Describe the experience of playing a game for 10 hours straight.",imposter:"Describe the experience of completing a game 100 percent."},
    {real:"What is the best thing about retro gaming?",imposter:"What is the best thing about modern gaming?"},
    {real:"Describe the perfect gaming setup.",imposter:"Describe the perfect gaming session."},
    {real:"What is the most overrated game of all time?",imposter:"What is the most underrated game of all time?"},
    {real:"Describe the experience of playing online with strangers.",imposter:"Describe the experience of gaming with your best friends."},
    {real:"What is the best thing about Nintendo?",imposter:"What is the best thing about PlayStation?"},
    {real:"Describe the appeal of esports.",imposter:"Describe the appeal of speedrunning."},
    {real:"What makes a great horror game?",imposter:"What makes a great survival game?"},
    {real:"Describe the perfect game world you would want to live in.",imposter:"Describe the most terrifying game world you would not want to live in."},
    {real:"What is the best game mechanic ever invented?",imposter:"What is the most innovative game feature ever created?"},
    {real:"Describe how video games have influenced pop culture.",imposter:"Describe how pop culture has influenced video games."},
    {real:"What is the best thing about Minecraft?",imposter:"What is the best thing about Roblox?"},
    {real:"Describe the most satisfying moment in gaming.",imposter:"Describe the most frustrating moment in gaming."},
    {real:"What is the best game franchise of all time?",imposter:"What is the best indie game ever made?"},
    {real:"Describe the experience of playing a Souls game for the first time.",imposter:"Describe the experience of playing a Mario game for the first time."},
    {real:"What is the most impressive graphics in gaming history?",imposter:"What is the most impressive AI in gaming history?"},
    {real:"Describe the appeal of farming and simulation games.",imposter:"Describe the appeal of city builder games."},
    {real:"What would your perfect video game character look like?",imposter:"What would your perfect game world look like?"},
    {real:"Describe the best RPG story ever told.",imposter:"Describe the best action-adventure story ever told in a game."},
    {real:"What is the biggest gaming controversy of all time?",imposter:"What is the biggest gaming disappointment of all time?"},
    {real:"Describe the impact of Fortnite on gaming culture.",imposter:"Describe the impact of Call of Duty on gaming culture."},
    {real:"What makes a great puzzle game?",imposter:"What makes a great platformer?"},
    {real:"Describe the most iconic video game character ever created.",imposter:"Describe the most iconic video game level ever designed."},
    {real:"What is the best thing about gaming communities?",imposter:"What is the worst thing about gaming communities?"},
    {real:"Describe the experience of being a game developer.",imposter:"Describe the experience of being a professional game tester."},
    {real:"What is the most impressive speedrun ever achieved?",imposter:"What is the most impressive game completion ever recorded?"},
    {real:"Describe the perfect game-to-movie adaptation.",imposter:"Describe the perfect game-to-TV adaptation."},
    {real:"What is the most important game that changed the industry?",imposter:"What is the most important console that changed gaming?"},
    {real:"Describe the experience of going to a gaming convention.",imposter:"Describe the experience of attending an esports tournament."},
    {real:"What is the best co-op game ever made?",imposter:"What is the best competitive game ever made?"},
    {real:"Describe the most iconic gaming moment in history.",imposter:"Describe the most iconic gaming controversy in history."},
    {real:"What makes a great game sequel?",imposter:"What makes a terrible game sequel?"},
    {real:"Describe the appeal of Pokemon.",imposter:"Describe the appeal of Zelda."},
    {real:"What is the best thing about gaming on PC?",imposter:"What is the best thing about gaming on console?"},
    {real:"Describe the most creative game ever made.",imposter:"Describe the most ambitious game ever made."},
    {real:"What is the most satisfying loot system in gaming?",imposter:"What is the most satisfying progression system in gaming?"},
    {real:"What is the best thing about retro pixel art games?",imposter:"What is the best thing about photorealistic modern games?"},
    {real:"Describe the impact of streaming on gaming culture.",imposter:"Describe the impact of YouTube on gaming culture."},
    {real:"What is the most iconic cheat code in gaming history?",imposter:"What is the most iconic Easter egg in gaming history?"},
    {real:"Describe the experience of playing a horror game alone at night.",imposter:"Describe the experience of watching someone else play a horror game."},
    {real:"What is the best way to experience a story-driven game?",imposter:"What is the best way to experience an open world game?"},
    {real:"Describe the appeal of mobile gaming.",imposter:"Describe the appeal of VR gaming."},
    {real:"What is the most satisfying ending in gaming history?",imposter:"What is the most disappointing ending in gaming history?"},
    {real:"Describe the experience of playing a game that made you cry.",imposter:"Describe the experience of playing a game that made you laugh out loud."},
    {real:"What is the best thing about sandbox games?",imposter:"What is the best thing about linear games?"},
    {real:"Describe the most iconic weapon in gaming history.",imposter:"Describe the most iconic vehicle in gaming history."},
    {real:"What makes a great fighting game?",imposter:"What makes a great racing game?"},
    {real:"Describe the experience of getting a platinum trophy.",imposter:"Describe the experience of completing a 100-hour game."},
    {real:"What is the most iconic game music theme ever written?",imposter:"What is the most iconic game sound effect ever created?"},
    {real:"Describe the appeal of narrative adventure games.",imposter:"Describe the appeal of walking simulators."},
    {real:"What is the most impressive world-building in gaming?",imposter:"What is the most impressive character development in gaming?"},
    {real:"Describe how gaming has evolved in the last 30 years.",imposter:"Describe how gaming might evolve in the next 30 years."},
    {real:"What is the most intense game you have ever played?",imposter:"What is the most relaxing game you have ever played?"},
    {real:"Describe the perfect roguelike game.",imposter:"Describe the perfect metroidvania game."},
    {real:"What is the best in-game economy ever designed?",imposter:"What is the best in-game crafting system ever designed?"},
    {real:"What is the most anticipated game sequel of all time?",imposter:"What is the most anticipated game remake of all time?"},
    {real:"Describe the impact of microtransactions on gaming.",imposter:"Describe the impact of loot boxes on gaming."},
    {real:"What is the best tutorial ever designed in a game?",imposter:"What is the best difficulty system ever designed in a game?"},
    {real:"Describe the most iconic gaming rivalry.",imposter:"Describe the most iconic gaming partnership."},
    {real:"What makes a great sports video game?",imposter:"What makes a great simulation game?"},
    {real:"Describe the experience of discovering a hidden secret in a game.",imposter:"Describe the experience of finding a game-breaking glitch."},
    {real:"Describe the best thing about the Legend of Zelda series.",imposter:"Describe the best thing about the Final Fantasy series."},
    {real:"What is the most dramatic moment in esports history?",imposter:"What is the most impressive individual esports performance ever?"},
    {real:"Describe the experience of playing a game with a twist ending.",imposter:"Describe the experience of playing a game with multiple endings."},
    {real:"What makes a great stealth game?",imposter:"What makes a great hacking mechanic in a game?"},
    {real:"Describe the most beautiful landscape in gaming.",imposter:"Describe the most memorable dungeon in gaming."},
    {real:"What is the best thing about couch co-op gaming?",imposter:"What is the best thing about online co-op gaming?"},
    {real:"What is the best Easter egg ever hidden in a game?",imposter:"What is the best secret level ever hidden in a game?"},
    {real:"Describe the most culturally significant video game.",imposter:"Describe the most politically significant video game."},
    {real:"What is the most iconic controller in gaming history?",imposter:"What is the most innovative controller in gaming history?"},
    {real:"Describe the appeal of rhythm games.",imposter:"Describe the appeal of visual novel games."},
    {real:"Describe the experience of playing a game in a language you do not speak.",imposter:"Describe the experience of playing a game with no HUD."},
    {real:"What is the most influential indie game ever made?",imposter:"What is the most influential AAA game ever made?"},
    {real:"Describe the most creative level design in gaming history.",imposter:"Describe the most creative enemy design in gaming history."},
    {real:"Describe the most iconic moment in Nintendo history.",imposter:"Describe the most iconic moment in PlayStation history."},
    {real:"What is the best thing about the Dark Souls series?",imposter:"What is the best thing about the Witcher series?"},
    {real:"Describe the experience of a perfect no-death run.",imposter:"Describe the experience of a perfect speedrun attempt."},
    {real:"What is the most heartwarming moment in gaming?",imposter:"What is the most heartbreaking moment in gaming?"},
    {real:"Describe what made GTA San Andreas so iconic.",imposter:"Describe what made Skyrim so iconic."},
    {real:"What is the best gaming moment from the last five years?",imposter:"What is the most disappointing gaming moment from the last five years?"},
    {real:"Describe the experience of completing a game on the hardest difficulty.",imposter:"Describe the experience of playing a game on easy mode for the first time."},
    {real:"What is the most impressive NPC behaviour in a game?",imposter:"What is the most impressive procedural generation in a game?"},
    {real:"What is the most surprising thing that happened in gaming history?",imposter:"What is the most important business decision ever made by a games company?"},
    {real:"Describe the experience of finishing a game and not knowing what to do with your life.",imposter:"Describe the experience of abandoning a game you will never finish."},
    {real:"Describe the most iconic game over screen.",imposter:"Describe the most iconic game loading screen."},
    {real:"What is the best card game video game adaptation?",imposter:"What is the best tabletop game video game adaptation?"},
    {real:"What would the perfect gaming subscription service include?",imposter:"What would the perfect gaming achievement system look like?"},
    {real:"Describe the experience of watching a game get patched and ruined.",imposter:"Describe the experience of watching a game get patched and saved."},
  ],
  sport: [
    {real:"Describe the perfect football match.",imposter:"Describe the perfect rugby match."},
    {real:"What makes a great athlete?",imposter:"What makes a great coach?"},
    {real:"Describe the most iconic sports moment ever.",imposter:"Describe the most controversial sports moment ever."},
    {real:"What is overrated about professional football?",imposter:"What is overrated about professional tennis?"},
    {real:"Describe the experience of running a marathon.",imposter:"Describe the experience of completing a triathlon."},
    {real:"What makes a great team sport?",imposter:"What makes a great individual sport?"},
    {real:"Describe the best Olympic moment of all time.",imposter:"Describe the best World Cup moment of all time."},
    {real:"What is the best thing about gym culture?",imposter:"What is the worst thing about gym culture?"},
    {real:"Describe the perfect training routine.",imposter:"Describe the perfect recovery routine."},
    {real:"What makes a great sports rivalry?",imposter:"What makes a great sports partnership?"},
    {real:"Describe the experience of watching your team win a championship.",imposter:"Describe the experience of watching your team get relegated."},
    {real:"What is the most impressive athletic feat ever achieved?",imposter:"What is the most impressive sports record ever broken?"},
    {real:"Describe the appeal of extreme sports.",imposter:"Describe the appeal of endurance sports."},
    {real:"What is the best thing about following a sport as a fan?",imposter:"What is the worst thing about following a sport as a fan?"},
    {real:"Describe the experience of playing sport competitively.",imposter:"Describe the experience of playing sport recreationally."},
    {real:"What makes a great sports commentator?",imposter:"What makes a great sports analyst?"},
    {real:"Describe the most dramatic penalty shootout ever.",imposter:"Describe the most dramatic last-minute winner ever."},
    {real:"What is the best sporting event to attend live?",imposter:"What is the best sporting event to watch on TV?"},
    {real:"Describe the impact of social media on professional athletes.",imposter:"Describe the impact of sponsorship on professional athletes."},
    {real:"What is the most gruelling sport in the world?",imposter:"What is the most technical sport in the world?"},
    {real:"Describe the experience of recovering from a sports injury.",imposter:"Describe the experience of training through pain."},
    {real:"What makes a great stadium?",imposter:"What makes a great sports arena?"},
    {real:"Describe the appeal of cricket.",imposter:"Describe the appeal of baseball."},
    {real:"What is the biggest scandal in sports history?",imposter:"What is the biggest upset in sports history?"},
    {real:"Describe the most impressive comeback in sports history.",imposter:"Describe the most heartbreaking defeat in sports history."},
    {real:"What is the best sport to play casually?",imposter:"What is the best sport to watch casually?"},
    {real:"Describe the experience of being a sports journalist.",imposter:"Describe the experience of being a sports photographer."},
    {real:"What makes a great manager in football?",imposter:"What makes a great manager in basketball?"},
    {real:"Describe the experience of representing your country in sport.",imposter:"Describe the experience of winning a club championship."},
    {real:"What is the most impressive dribble in football history?",imposter:"What is the most impressive serve in tennis history?"},
    {real:"Describe the perfect pre-match routine.",imposter:"Describe the perfect post-match routine."},
    {real:"What is the biggest transfer in football history?",imposter:"What is the most surprising free agent signing in basketball history?"},
    {real:"Describe the appeal of motorsport.",imposter:"Describe the appeal of cycling as a sport."},
    {real:"What makes a great sports documentary?",imposter:"What makes a great sports biography?"},
    {real:"Describe the experience of completing a Tough Mudder.",imposter:"Describe the experience of completing an Ironman triathlon."},
    {real:"What is the best thing about the Premier League?",imposter:"What is the best thing about the Champions League?"},
    {real:"Describe what it feels like to break a personal record.",imposter:"Describe what it feels like to reach peak fitness."},
    {real:"What is the most important mental quality in a professional athlete?",imposter:"What is the most important physical quality in a professional athlete?"},
    {real:"Describe the most emotional medal ceremony in Olympic history.",imposter:"Describe the most emotional trophy lift in football history."},
    {real:"What is the best thing about mixed martial arts?",imposter:"What is the best thing about boxing?"},
    {real:"Describe the appeal of golf.",imposter:"Describe the appeal of snooker."},
    {real:"Describe the experience of meeting your sporting hero.",imposter:"Describe the experience of watching your sporting hero retire."},
    {real:"What is the most technically impressive skill in football?",imposter:"What is the most technically impressive skill in basketball?"},
    {real:"Describe the role of sports science in modern athletics.",imposter:"Describe the role of sports psychology in modern athletics."},
    {real:"What is the best sporting moment from the last decade?",imposter:"What is the best sporting performance from the last decade?"},
    {real:"Describe the experience of playing sport in terrible weather.",imposter:"Describe the experience of watching sport in terrible weather."},
    {real:"What makes a great penalty taker?",imposter:"What makes a great free kick specialist?"},
    {real:"Describe the atmosphere at a sold-out football ground.",imposter:"Describe the atmosphere at a sold-out tennis grand slam."},
    {real:"What is the most impressive team performance in sports history?",imposter:"What is the most impressive individual performance in sports history?"},
    {real:"Describe the experience of coaching a youth sports team.",imposter:"Describe the experience of refereeing a competitive match."},
    {real:"What is the best thing about the Olympics?",imposter:"What is the best thing about the Paralympic Games?"},
    {real:"Describe the experience of doing a combat sport for the first time.",imposter:"Describe the experience of doing a water sport for the first time."},
    {real:"What is the most controversial decision in sporting history?",imposter:"What is the most controversial rule change in sporting history?"},
    {real:"Describe how doping has affected sport.",imposter:"Describe how gambling has affected sport."},
    {real:"What is the best underdog story in sports history?",imposter:"What is the best dynasty story in sports history?"},
    {real:"Describe the experience of going to a boxing match.",imposter:"Describe the experience of going to a wrestling event."},
    {real:"What makes a great sprint finish?",imposter:"What makes a great long-distance race?"},
    {real:"Describe the impact of Usain Bolt on athletics.",imposter:"Describe the impact of Michael Jordan on basketball."},
    {real:"What is the best thing about American football?",imposter:"What is the best thing about Australian rules football?"},
    {real:"Describe the experience of learning to ski.",imposter:"Describe the experience of learning to surf."},
    {real:"What is the most impressive save in football history?",imposter:"What is the most impressive catch in cricket history?"},
    {real:"Describe the perfect gym workout.",imposter:"Describe the perfect outdoor workout."},
    {real:"What is the most exciting sport you have ever watched?",imposter:"What is the most exciting sport you have ever played?"},
    {real:"Describe the appeal of following a lower league football club.",imposter:"Describe the appeal of following a non-league football club."},
    {real:"What would you change about the rules of football?",imposter:"What would you change about the rules of rugby?"},
    {real:"Describe the experience of watching a Grand Slam tennis match.",imposter:"Describe the experience of watching a Formula One Grand Prix."},
    {real:"What is the best rivalry in football history?",imposter:"What is the best rivalry in tennis history?"},
    {real:"Describe what separates a good player from a great one.",imposter:"Describe what separates a great player from a legend."},
    {real:"Describe the experience of going to a stadium for the first time as a child.",imposter:"Describe the experience of taking your child to a stadium for the first time."},
    {real:"What makes a great tackle in rugby?",imposter:"What makes a great block in basketball?"},
    {real:"Describe the experience of completing a personal fitness challenge.",imposter:"Describe the experience of setting a new fitness goal."},
    {real:"What is the best thing about winter sports?",imposter:"What is the best thing about water sports?"},
    {real:"Describe the most iconic jersey in sports history.",imposter:"Describe the most iconic sports shoe in history."},
    {real:"What is the most important quality in a sports team captain?",imposter:"What is the most important quality in a sports team manager?"},
    {real:"What is the greatest comeback from 3-0 down in sports history?",imposter:"What is the greatest performance under pressure in sports history?"},
    {real:"Describe how crowd noise affects a sporting performance.",imposter:"Describe how home advantage affects a sporting performance."},
    {real:"What is the best thing about women sport?",imposter:"What is the biggest challenge facing women sport?"},
    {real:"Describe the most impressive display of teamwork in sports history.",imposter:"Describe the most impressive display of individual brilliance in sports history."},
    {real:"What is the best thing about sport for mental health?",imposter:"What is the best thing about sport for physical health?"},
    {real:"Describe the experience of playing five-a-side football.",imposter:"Describe the experience of playing padel for the first time."},
    {real:"Describe the most inspirational speech by a coach.",imposter:"Describe the most inspirational post-match interview ever."},
    {real:"What is the best thing about watching sport with friends?",imposter:"What is the best thing about watching sport alone?"},
    {real:"Describe the experience of winning a penalty in the 90th minute.",imposter:"Describe the experience of conceding a penalty in the 90th minute."},
    {real:"What is the most technically demanding position in football?",imposter:"What is the most physically demanding position in rugby?"},
    {real:"Describe the experience of an athlete retiring.",imposter:"Describe the experience of an athlete making a comeback."},
    {real:"What is the most impressive display of sportsmanship ever?",imposter:"What is the most disgraceful display of poor sportsmanship ever?"},
    {real:"What would your ideal sports career look like?",imposter:"What would your ideal coaching career look like?"},
    {real:"What is the best thing about road cycling?",imposter:"What is the best thing about track cycling?"},
    {real:"What is the most important invention in sports technology?",imposter:"What is the most controversial technology introduced to sport?"},
    {real:"Describe the perfect commentary for a last-minute goal.",imposter:"Describe the perfect commentary for a championship-winning point."},
    {real:"What is the most iconic piece of football kit ever designed?",imposter:"What is the most iconic piece of athletic wear ever designed?"},
    {real:"Describe the experience of playing sport as a child versus as an adult.",imposter:"Describe the experience of watching sport as a child versus as an adult."},
    {real:"What is the best thing about the Ryder Cup?",imposter:"What is the best thing about the Ashes?"},
    {real:"Describe the experience of playing sport at altitude.",imposter:"Describe the experience of playing sport in extreme heat."},
    {real:"What makes a great half-time team talk?",imposter:"What makes a great training ground drill?"},
    {real:"Describe the most nail-biting finish in sports history.",imposter:"Describe the most one-sided result in sports history."},
    {real:"What is the best thing about Sunday morning amateur sport?",imposter:"What is the best thing about Monday night professional sport?"},
  ],
  spicy: [
    {real:"Describe your worst date ever.",imposter:"Describe your most awkward date ever."},
    {real:"What is the most embarrassing thing you have done sober?",imposter:"What is the most embarrassing thing you have done drunk?"},
    {real:"Describe your type in a partner.",imposter:"Describe your type in a best friend."},
    {real:"What is the biggest lie you have ever told?",imposter:"What is the biggest secret you have kept?"},
    {real:"Describe the most awkward family moment.",imposter:"Describe the most awkward work moment."},
    {real:"What would your ex say about you?",imposter:"What would your best friend say about you?"},
    {real:"Describe your most controversial opinion.",imposter:"Describe your most unpopular opinion."},
    {real:"What is something you would never admit in public?",imposter:"What is something you would never admit to your parents?"},
    {real:"Describe the worst gift you have ever received.",imposter:"Describe the worst gift you have ever given."},
    {real:"What is the pettiest thing you have ever done?",imposter:"What is the most passive-aggressive thing you have ever done?"},
    {real:"Describe ghosting someone.",imposter:"Describe being ghosted."},
    {real:"What is your most irrational fear?",imposter:"What is your most irrational habit?"},
    {real:"Describe the most cringe thing you did as a teenager.",imposter:"Describe the most cringe thing you do as an adult."},
    {real:"Describe catching someone in a lie.",imposter:"Describe being caught in a lie."},
    {real:"What would you do with a day of total invisibility?",imposter:"What would you do with a day of total anonymity online?"},
    {real:"Describe the most dramatic breakup you have witnessed.",imposter:"Describe the most dramatic argument you have witnessed."},
    {real:"What is the most money you have wasted on something stupid?",imposter:"What is the most time you have wasted on something stupid?"},
    {real:"Describe your most toxic trait.",imposter:"Describe your most annoying habit."},
    {real:"What is something you pretend to like but secretly hate?",imposter:"What is something you pretend to hate but secretly like?"},
    {real:"Describe your social media persona versus your real self.",imposter:"Describe your work persona versus your real self."},
    {real:"What would your search history reveal about you?",imposter:"What would your messages reveal about you?"},
    {real:"Describe the worst job you have ever had.",imposter:"Describe the worst boss you have ever had."},
    {real:"What is the most irresponsible thing you have done?",imposter:"What is the most impulsive thing you have done?"},
    {real:"Describe your relationship with money.",imposter:"Describe your relationship with success."},
    {real:"What is the most awkward thing that has happened to you on a date?",imposter:"What is the most awkward thing that has happened to you at work?"},
    {real:"Describe your most embarrassing drunk story.",imposter:"Describe your most embarrassing sober story."},
    {real:"What is the worst thing you have said to someone you love?",imposter:"What is the worst thing someone you love has said to you?"},
    {real:"Describe a time you completely misjudged someone.",imposter:"Describe a time someone completely misjudged you."},
    {real:"What is the most shameful thing on your internet history?",imposter:"What is the most shameful thing in your camera roll?"},
    {real:"Describe your most embarrassing fashion phase.",imposter:"Describe your most embarrassing music phase."},
    {real:"What is the biggest misunderstanding you have ever caused?",imposter:"What is the biggest misunderstanding you have ever been part of?"},
    {real:"Describe your worst ever hangover.",imposter:"Describe the worst night out that ended badly."},
    {real:"What is the most childish thing you still do?",imposter:"What is the most adult thing you refuse to do?"},
    {real:"Describe a time you got away with something you should not have.",imposter:"Describe a time you got caught doing something you should not have."},
    {real:"What is the most cringeworthy text you have sent?",imposter:"What is the most cringeworthy voicemail you have left?"},
    {real:"Describe your relationship with your phone.",imposter:"Describe your relationship with social media."},
    {real:"What is the most jealous you have ever felt?",imposter:"What is the most envious you have ever felt?"},
    {real:"Describe the moment you knew a relationship was over.",imposter:"Describe the moment you knew a friendship was over."},
    {real:"What is something you have never admitted to anyone?",imposter:"What is something you have never admitted to yourself?"},
    {real:"Describe being rejected by someone you liked.",imposter:"Describe rejecting someone who liked you."},
    {real:"What is the most ridiculous argument you have had?",imposter:"What is the most pointless grudge you have held?"},
    {real:"Describe your worst ever job interview.",imposter:"Describe your worst ever first day at work."},
    {real:"What is the most embarrassing thing your parents have done?",imposter:"What is the most embarrassing thing your friends have done?"},
    {real:"Describe a time you completely lost your temper.",imposter:"Describe a time you completely broke down in tears."},
    {real:"What is the most embarrassing thing you have said to a stranger?",imposter:"What is the most embarrassing thing a stranger has said to you?"},
    {real:"Describe the worst feedback you have ever received.",imposter:"Describe the worst feedback you have ever given."},
    {real:"What is the most you have ever spent on something completely pointless?",imposter:"What is the least you have ever spent on something that changed your life?"},
    {real:"Describe your most regrettable purchase.",imposter:"Describe your most regrettable haircut."},
    {real:"Describe your most embarrassing autocorrect fail.",imposter:"Describe your most embarrassing email mistake."},
    {real:"What is the most painfully awkward silence you have experienced?",imposter:"What is the most painfully awkward conversation you have had?"},
    {real:"Describe a time you accidentally sent a message to the wrong person.",imposter:"Describe a time you accidentally replied all to a work email."},
    {real:"What is the most embarrassing thing you have done in front of a crowd?",imposter:"What is the most embarrassing thing you have done in front of a crush?"},
    {real:"Describe the most awkward family dinner you have attended.",imposter:"Describe the most awkward work Christmas party you have attended."},
    {real:"What is the most childish argument you have had as an adult?",imposter:"What is the most adult problem you have handled in a childish way?"},
    {real:"What is the most embarrassing thing you did trying to impress someone?",imposter:"What is the most embarrassing thing you did trying to fit in?"},
    {real:"Describe getting caught talking about someone who was right behind you.",imposter:"Describe getting caught doing something you should not at work."},
    {real:"What is the most embarrassing injury you have ever had?",imposter:"What is the most embarrassing illness you have ever had?"},
    {real:"Describe a time you laughed at completely the wrong moment.",imposter:"Describe a time you cried at completely the wrong moment."},
    {real:"What is the worst thing you have ever cooked for someone?",imposter:"What is the worst thing you have ever ordered at a restaurant?"},
    {real:"Describe falling asleep somewhere you really should not have.",imposter:"Describe waking up somewhere you did not expect to be."},
    {real:"What is your most embarrassing talent?",imposter:"What is your most pointless skill?"},
    {real:"What is the most embarrassing thing you believed as a child?",imposter:"What is the most embarrassing thing you thought was cool as a teenager?"},
    {real:"Describe a time you pretended to know something you did not.",imposter:"Describe a time you pretended to be someone you were not."},
    {real:"What is the most expensive mistake you have ever made?",imposter:"What is the most time-consuming mistake you have ever made?"},
    {real:"Describe your most embarrassing public transport moment.",imposter:"Describe your most embarrassing supermarket moment."},
    {real:"What is the most childish thing you have done to get revenge?",imposter:"What is the most elaborate thing you have done to avoid confrontation?"},
    {real:"Describe lying to get out of plans and then being caught.",imposter:"Describe making an excuse and forgetting you had used it before."},
    {real:"Describe forgetting someone name after knowing them for years.",imposter:"Describe calling someone by the wrong name repeatedly."},
    {real:"What is the most embarrassing thing you have said during a presentation?",imposter:"What is the most embarrassing thing you have said during a job interview?"},
    {real:"What is the most embarrassing thing you have ever Googled?",imposter:"What is the most embarrassing thing you have ever asked a stranger?"},
    {real:"Describe the worst advice you have ever given someone.",imposter:"Describe the worst advice you have ever taken."},
    {real:"What is the most awkward compliment you have ever given?",imposter:"What is the most awkward compliment you have ever received?"},
    {real:"Describe a time your confidence completely let you down.",imposter:"Describe a time your shyness completely let you down."},
    {real:"What is the most embarrassing way you have tried to get someone attention?",imposter:"What is the most embarrassing way you have tried to avoid someone?"},
    {real:"Describe accidentally revealing something too personal in a group chat.",imposter:"Describe accidentally posting something too personal on social media."},
    {real:"What is the most childish thing you have done when you did not get your way?",imposter:"What is the most petty thing you have done after a falling out?"},
    {real:"Describe the most embarrassing thing you have worn in public.",imposter:"Describe the most embarrassing haircut you have ever had."},
    {real:"What is the most embarrassing nickname you have ever had?",imposter:"What is the most embarrassing username you have ever used?"},
    {real:"Describe the time you were most dramatically wrong about something.",imposter:"Describe the time you most confidently stated something completely incorrect."},
    {real:"What is the most embarrassing thing you have done to seem interesting?",imposter:"What is the most embarrassing thing you have done to seem cool?"},
    {real:"Describe a time you completely blanked on someone name mid-introduction.",imposter:"Describe a time you completely forgot what you were saying mid-sentence."},
    {real:"What is the most awkward dinner party moment you have witnessed?",imposter:"What is the most awkward house party moment you have witnessed?"},
    {real:"Describe the worst thing you ever did to a sibling.",imposter:"Describe the worst thing a sibling ever did to you."},
    {real:"What is the most embarrassing thing you have done trying to look busy?",imposter:"What is the most obvious lie you have told to get out of something?"},
    {real:"Describe oversharing with someone you had just met.",imposter:"Describe undersharing to the point of seeming rude."},
    {real:"Describe accidentally insulting someone cooking without realising.",imposter:"Describe accidentally insulting someone home without realising."},
    {real:"Describe a time autocorrect completely changed the meaning of your message.",imposter:"Describe a time a typo caused a serious misunderstanding."},
    {real:"What is the most embarrassing thing that has happened to you at a wedding?",imposter:"What is the most embarrassing thing that has happened to you at a funeral?"},
    {real:"Describe the most embarrassing thing you have done on a first date.",imposter:"Describe the most embarrassing thing you have done on a last date."},
    {real:"What is the most ridiculous reason you have cried?",imposter:"What is the most ridiculous reason you have laughed uncontrollably?"},
    {real:"Describe the moment you realised you had been completely wrong about someone.",imposter:"Describe the moment you realised someone had been completely wrong about you."},
    {real:"What is the most embarrassing thing you have done when home alone?",imposter:"What is the most embarrassing thing you have done thinking no one was watching?"},
    {real:"Describe accidentally liking a very old photo on social media.",imposter:"Describe accidentally following someone you were stalking online."},
    {real:"Describe the most embarrassing thing your phone has done at the worst time.",imposter:"Describe the most embarrassing thing your computer has done in public."},
    {real:"What is the most embarrassing selfie you have ever accidentally sent?",imposter:"What is the most embarrassing photo of you that someone else posted?"},
    {real:"What is the most ridiculous thing you have argued about with a partner?",imposter:"What is the most ridiculous thing you have argued about with a friend?"},
    {real:"Describe a time you embarrassed yourself in front of someone you wanted to impress.",imposter:"Describe a time you embarrassed someone else without meaning to."},
    {real:"What is the most childish reason you have ever refused to apologise?",imposter:"What is the most adult thing you have ever had to apologise for?"},
  ],
};

QUESTION_PAIRS.all = Object.values(QUESTION_PAIRS).flat();

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
const fmt = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

const PHASES = {
  MAIN_MENU:"main_menu", SETTINGS:"settings", LOBBY:"lobby", ONLINE:"online",
  QUESTION_EDITOR:"question_editor", ROUND_START:"round_start",
  PASSING:"passing", DISCUSSION:"discussion",
  ACCUSE:"accuse", VOTING:"voting", REVEAL:"reveal", SCOREBOARD:"scoreboard",
};
const MODES = { QUESTIONER:"questioner", VOTE:"vote" };

// ── Online mode config — replace with your Railway URL after deploy ────────────
const SERVER_URL = (typeof window !== "undefined" && window.GAME_SERVER_URL)
  || "wss://YOUR-APP.railway.app";   // ← update this after Railway deploy

const ONLINE_PHASES = {
  HOME:"online_home",            // create or join
  CREATING:"online_creating",   // create room form
  JOINING:"online_joining",     // join room form
  BROWSE:"online_browse",       // browse public rooms
  WAITING:"online_waiting",     // in lobby waiting for host to start
  ROLE_REVEAL:"online_role",    // seeing your private role
  ANSWERING:"online_answering", // typing your answer
  DISCUSSION:"online_discussion",
  ACCUSE:"online_accuse",
  VOTING:"online_voting",
  REVEAL:"online_reveal",
  SCOREBOARD:"online_scoreboard",
};
const PLAYER_COLORS = ["#E05C5C","#5C9FE0","#5CCE8A","#E0C15C","#A05CE0","#E07A5C","#5CCEC8","#E05CB0"];
const TIMER_OPTIONS = [{label:"30s",value:30},{label:"1m",value:60},{label:"90s",value:90},{label:"2m",value:120},{label:"3m",value:180}];

// ── Timer Ring ────────────────────────────────────────────────────────────────
function TimerRing({ seconds, total }) {
  const r=38, circ=2*Math.PI*r, dash=(seconds/total)*circ;
  const color = seconds<=10?"#E05C5C":seconds<=30?"#E0C15C":"#5C9FE0";
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:12}}>
      <svg width={96} height={96} style={{transform:"rotate(-90deg)"}}>
        <circle cx={48} cy={48} r={r} fill="none" stroke="#2a2a3a" strokeWidth={7}/>
        <circle cx={48} cy={48} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{transition:"stroke-dasharray 0.9s linear,stroke 0.3s"}}/>
      </svg>
      <div style={{position:"relative",top:-66,fontSize:22,fontWeight:700,color:seconds<=10?"#E05C5C":"#e0e0e0",
        animation:seconds<=10?"pulse 0.6s ease-in-out infinite alternate":"none"}}>{fmt(seconds)}</div>
      <div style={{position:"relative",top:-62,fontSize:11,color:"#666",letterSpacing:1,textTransform:"uppercase"}}>discussion</div>
    </div>
  );
}

// ── Toggle component ──────────────────────────────────────────────────────────
function Toggle({ value, onChange, label, sub }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #1e1e2e"}}
      onClick={()=>onChange(!value)}>
      <div>
        <div style={{fontSize:15,fontWeight:600,color:"#e0e0e0"}}>{label}</div>
        {sub && <div style={{fontSize:12,color:"#555",marginTop:2}}>{sub}</div>}
      </div>
      <div style={{width:44,height:26,borderRadius:13,background:value?"#5C9FE0":"#2a2a3a",
        position:"relative",transition:"background 0.2s",flexShrink:0,cursor:"pointer"}}>
        <div style={{position:"absolute",top:3,left:value?20:3,width:20,height:20,
          borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
      </div>
    </div>
  );
}

// ── Handoff Card ──────────────────────────────────────────────────────────────
function HandoffCard({ icon, title, hint, btnLabel, btnColor="#5CCE8A", onTap, sub }) {
  return (
    <div style={{...S.handoffCard}}>
      <div style={{fontSize:60,marginBottom:12}}>{icon}</div>
      <h2 style={S.handoffTitle}>{title}</h2>
      {hint && <p style={S.handoffHint}>{hint}</p>}
      <button style={{...S.bigBtn,background:btnColor,fontSize:18,padding:18,marginTop:8}} onClick={onTap}>{btnLabel}</button>
      {sub && <p style={{fontSize:12,color:"#444",textAlign:"center",marginTop:12}}>{sub}</p>}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // Settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [gameMode, setGameMode] = useState(MODES.QUESTIONER);
  const [totalRounds, setTotalRounds] = useState(6);
  const [discussionTime, setDiscussionTime] = useState(90);
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Sync settings to globals
  useEffect(() => { soundOn = soundEnabled; }, [soundEnabled]);
  useEffect(() => { hapticOn = hapticEnabled; }, [hapticEnabled]);
  useEffect(() => { flashOn = flashEnabled; }, [flashEnabled]);
  useEffect(() => { ttsOn = ttsEnabled; }, [ttsEnabled]);

  // Game state
  const [phase, setPhase] = useState(PHASES.MAIN_MENU);
  const [players, setPlayers] = useState([]);
  const [nameInput, setNameInput] = useState("");
  const [round, setRound] = useState(0);
  const [roundData, setRoundData] = useState(null);
  const [accuseTarget, setAccuseTarget] = useState(null);
  const [votes, setVotes] = useState({}); // {playerIdx: targetIdx}
  const [votingPlayerIdx, setVotingPlayerIdx] = useState(0);
  const [votingStep, setVotingStep] = useState("waiting"); // "waiting" | "voting" | "done"
  const [answerInput, setAnswerInput] = useState("");
  const [passingStep, setPassingStep] = useState("waiting");
  const [passingPlayerIdx, setPassingPlayerIdx] = useState(0);

  // ── Online multiplayer state ──────────────────────────────────────────────
  const [onlinePhase, setOnlinePhase] = useState(ONLINE_PHASES.HOME);
  const [ws, setWs] = useState(null);
  const [onlineError, setOnlineError] = useState("");
  const [myId, setMyId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [onlineSettings, setOnlineSettings] = useState({ mode:"questioner", totalRounds:6, discussionTime:90, category:"all" });
  const [myRole, setMyRole] = useState(null);       // "questioner"|"impostor"|"player"
  const [myTopic, setMyTopic] = useState("");
  const [realQuestion, setRealQuestion] = useState("");
  const [onlineAnswers, setOnlineAnswers] = useState({});
  const [answeredIds, setAnsweredIds] = useState([]);
  const [onlineRound, setOnlineRound] = useState(0);
  const [onlineTotalRounds, setOnlineTotalRounds] = useState(6);
  const [onlineTimerSec, setOnlineTimerSec] = useState(0);
  const [onlineTimerTotal, setOnlineTimerTotal] = useState(90);
  const [revealData, setRevealData] = useState(null);
  const [myAnswer, setMyAnswer] = useState("");
  const [onlineVoteTarget, setOnlineVoteTarget] = useState(null);
  const [votedCount, setVotedCount] = useState(0);
  const [readyCount, setReadyCount] = useState(0);
  const [publicRooms, setPublicRooms] = useState([]);
  // Create form fields
  const [createName, setCreateName] = useState("");
  const [createRoomName, setCreateRoomName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  // Join form fields
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [myVoteCast, setMyVoteCast] = useState(false);
  const wsRef = useRef(null);

  // ── Online WebSocket connection ────────────────────────────────────────────
  const connectAndSend = (msgType, payload) => {
    setOnlineError("");
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: msgType, payload }));
      return;
    }
    // (re)connect
    try {
      const sock = new WebSocket(SERVER_URL);
      wsRef.current = sock;
      setWs(sock);
      sock.onopen = () => {
        sock.send(JSON.stringify({ type: msgType, payload }));
      };
      sock.onmessage = (e) => handleServerMessage(JSON.parse(e.data));
      sock.onerror   = () => setOnlineError("Could not connect to server. Check your connection.");
      sock.onclose   = () => {
        // Only show disconnect error if we were mid-game
        setWs(null);
      };
    } catch(e) {
      setOnlineError("WebSocket not supported or server unreachable.");
    }
  };

  const sendToServer = (type, payload={}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  };

  const handleServerMessage = (msg) => {
    const { type, payload } = msg;
    switch(type) {
      case "rooms_list":
        setPublicRooms(payload.rooms || []);
        break;
      case "room_created":
      case "room_joined":
        setMyId(payload.playerId);
        setRoomCode(payload.code);
        setRoomName(payload.roomName);
        setIsHost(payload.isHost);
        setOnlinePlayers(payload.players || []);
        setOnlineSettings(payload.settings || onlineSettings);
        setOnlineTotalRounds(payload.settings?.totalRounds || 6);
        setOnlinePhase(ONLINE_PHASES.WAITING);
        break;
      case "player_joined":
      case "player_left":
      case "player_disconnected":
        setOnlinePlayers(payload.players || []);
        break;
      case "settings_updated":
        setOnlineSettings(payload.settings);
        setOnlineTotalRounds(payload.settings.totalRounds);
        break;
      case "round_start":
        setMyRole(payload.role);
        setMyTopic(payload.topic);
        setRealQuestion(payload.realQuestion);
        setOnlineRound(payload.round);
        setOnlineTotalRounds(payload.totalRounds);
        setOnlinePlayers(payload.players || []);
        setMyAnswer("");
        setOnlineVoteTarget(null);
        setMyVoteCast(false);
        setAnsweredIds([]);
        setReadyCount(0);
        setOnlinePhase(ONLINE_PHASES.ROLE_REVEAL);
        break;
      case "ready_progress":
        setReadyCount(payload.readyCount);
        break;
      case "answering_start":
        setOnlinePhase(ONLINE_PHASES.ANSWERING);
        break;
      case "answer_progress":
        setAnsweredIds(payload.answeredIds || []);
        break;
      case "discussion_start":
        setOnlineAnswers(payload.answers || {});
        setRealQuestion(payload.realQuestion);
        setOnlineTimerSec(payload.discussionTime);
        setOnlineTimerTotal(payload.discussionTime);
        setOnlinePhase(ONLINE_PHASES.DISCUSSION);
        break;
      case "timer_tick":
        setOnlineTimerSec(payload.seconds);
        if (payload.seconds <= 10) { SFX.tickUrgent(); HX.tap(); }
        else if (payload.seconds === 30) SFX.tick();
        break;
      case "phase_change":
        if (payload.phase === "accuse")  setOnlinePhase(ONLINE_PHASES.ACCUSE);
        if (payload.phase === "voting")  setOnlinePhase(ONLINE_PHASES.VOTING);
        break;
      case "vote_progress":
        setVotedCount(payload.votedCount);
        break;
      case "round_reveal":
        setRevealData(payload);
        setOnlinePlayers(payload.players || []);
        SFX.reveal(); HX.success();
        setOnlinePhase(ONLINE_PHASES.REVEAL);
        break;
      case "game_over":
        setOnlinePlayers(payload.players || []);
        setOnlinePhase(ONLINE_PHASES.SCOREBOARD);
        break;
      case "returned_to_lobby":
        setOnlinePlayers(payload.players || []);
        setOnlinePhase(ONLINE_PHASES.WAITING);
        break;
      case "host_changed":
        setIsHost(payload.newHostId === myId);
        setOnlinePlayers(payload.players || []);
        break;
      case "kicked":
        wsRef.current?.close();
        setOnlinePhase(ONLINE_PHASES.HOME);
        setOnlineError("You were removed from the room.");
        break;
      case "error":
        setOnlineError(payload.message || "Something went wrong");
        break;
      default: break;
    }
  };

  const leaveOnline = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setWs(null);
    setOnlinePhase(ONLINE_PHASES.HOME);
    setOnlineError("");
    setMyId(null);
    setIsHost(false);
    setRoomCode("");
  };

  // ── Custom questions
  const [customQuestions, setCustomQuestions] = useState([]);
  const [useCustomOnly, setUseCustomOnly] = useState(false);
  const [editReal, setEditReal] = useState("");
  const [editImposter, setEditImposter] = useState("");
  const [editingIdx, setEditingIdx] = useState(null);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef(null);

  // Timer
  const [timerSec, setTimerSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!timerRunning) return;
    timerRef.current = setInterval(() => {
      setTimerSec(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setTimerRunning(false);
          SFX.timerEnd(); HX.timerEnd(); flashTorch(3,80);
          setPhase(gameMode === MODES.VOTE ? PHASES.VOTING : PHASES.ACCUSE);
          return 0;
        }
        const next = prev - 1;
        if (next <= 10) { SFX.tickUrgent(); HX.tap(); }
        else if (next === 30) SFX.tick();
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [timerRunning, gameMode]);

  const startTimer = useCallback(() => { setTimerSec(discussionTime); setTimerRunning(true); }, [discussionTime]);
  const stopTimer  = () => { clearInterval(timerRef.current); setTimerRunning(false); TTS.stop(); };

  // ── Lobby ─────────────────────────────────────────────────────────────────
  const addPlayer = () => {
    const name = nameInput.trim();
    if (!name || players.find(p=>p.name.toLowerCase()===name.toLowerCase()) || players.length>=8) return;
    HX.tap(); SFX.confirm();
    setPlayers(prev=>[...prev,{name,score:0,color:PLAYER_COLORS[prev.length%PLAYER_COLORS.length]}]);
    setNameInput("");
  };

  // ── Round setup ───────────────────────────────────────────────────────────
  const beginRound = (pl, roundNum) => {
    const basePool = useCustomOnly ? [] : (QUESTION_PAIRS[selectedCategory] || QUESTION_PAIRS.all);
    const pool = [...basePool, ...customQuestions];
    if (pool.length === 0) return;
    const pair = rand(pool);
    const shuffled = shuffle(pl.map((_,i)=>i));
    // In vote mode there is no questioner — everyone answers
    const qIdx = gameMode === MODES.VOTE ? -1 : shuffled[0];
    const impIdx = gameMode === MODES.VOTE ? shuffled[0] : shuffled[1];
    SFX.newRound(); HX.confirm(); flashTorch(1,200);
    setRound(roundNum+1);
    setRoundData({ questionerIdx:qIdx, imposterIdx:impIdx, pair, answers:{}, accusedIdx:null, submittedAnswers:new Set() });
    setPassingPlayerIdx(0);
    setPassingStep("waiting");
    setAnswerInput("");
    setAccuseTarget(null);
    setVotes({});
    setVotingPlayerIdx(0);
    setVotingStep("waiting");
    stopTimer();
    setPhase(PHASES.ROUND_START);
  };

  // ── Passing ───────────────────────────────────────────────────────────────
  const onPassReceived = () => {
    SFX.received(); HX.confirm();
    setPassingStep("role");
  };

  const onSubmitAndPass = (text, isQuestioner) => {
    if (!isQuestioner && !text.trim()) return;
    SFX.submit(); HX.tap();
    if (!isQuestioner) {
      setRoundData(prev => {
        const ns = new Set(prev.submittedAnswers); ns.add(passingPlayerIdx);
        return {...prev, answers:{...prev.answers,[passingPlayerIdx]:text.trim()}, submittedAnswers:ns};
      });
    }
    setAnswerInput("");
    const nextIdx = passingPlayerIdx + 1;
    if (nextIdx >= players.length) {
      setPassingStep("done");
    } else {
      setPassingPlayerIdx(nextIdx);
      setPassingStep("waiting");
    }
  };

  const onStartDiscussion = () => {
    SFX.received(); HX.success(); flashTorch(2,100);
    setPhase(PHASES.DISCUSSION);
    startTimer();
  };

  // ── Accusation (Questioner mode) ──────────────────────────────────────────
  const accuse = () => {
    if (accuseTarget === null) return;
    stopTimer();
    const correct = accuseTarget === roundData.imposterIdx;
    setRoundData(prev=>({...prev,accusedIdx:accuseTarget}));
    setPlayers(prev=>prev.map((p,i)=>{
      if (i===roundData.questionerIdx && correct) return {...p,score:p.score+2};
      if (i===roundData.imposterIdx && !correct) return {...p,score:p.score+3};
      return p;
    }));
    SFX.reveal(); HX.success(); flashTorch(correct?2:1,150);
    setPhase(PHASES.REVEAL);
  };

  // ── Voting (Vote mode) ────────────────────────────────────────────────────
  const onVoteReceived = () => { SFX.received(); HX.confirm(); setVotingStep("voting"); };

  const castVoteAndPass = (targetIdx) => {
    SFX.vote(); HX.tap();
    setVotes(prev=>({...prev,[votingPlayerIdx]:targetIdx}));
    const nextIdx = votingPlayerIdx + 1;
    if (nextIdx >= players.length) {
      setVotingStep("done");
    } else {
      setVotingPlayerIdx(nextIdx);
      setVotingStep("waiting");
    }
  };

  const tallyVotes = () => {
    const tally = {};
    Object.values(votes).forEach(t=>{ tally[t]=(tally[t]||0)+1; });
    const maxV = Math.max(...Object.values(tally));
    const winners = Object.keys(tally).filter(k=>tally[k]===maxV).map(Number);
    const accused = winners[Math.floor(Math.random()*winners.length)];
    const correct = accused === roundData.imposterIdx;
    setRoundData(prev=>({...prev,accusedIdx:accused,voteTally:tally}));
    // correct voters +1pt each; impostor +3pt if not caught
    setPlayers(prev=>prev.map((p,i)=>{
      if (i===roundData.imposterIdx) return correct ? p : {...p,score:p.score+3};
      return votes[i]===roundData.imposterIdx ? {...p,score:p.score+1} : p;
    }));
    SFX.reveal(); HX.success();
    setPhase(PHASES.REVEAL);
  };

  const allVoted = roundData && players.every((_,i)=>
    (gameMode===MODES.QUESTIONER && i===roundData.questionerIdx) || votes[i]!==undefined
  );

  // ── Next round / end ──────────────────────────────────────────────────────
  const nextRound = () => round >= totalRounds ? setPhase(PHASES.SCOREBOARD) : beginRound(players, round);
  const resetGame = () => { setPlayers(p=>p.map(x=>({...x,score:0}))); setPhase(PHASES.MAIN_MENU); setRound(0); setRoundData(null); stopTimer(); };
  const isLastRound = round >= totalRounds;

  // ── Custom Q editor helpers ───────────────────────────────────────────────
  const saveEdit = () => {
    if (!editReal.trim()||!editImposter.trim()) return;
    const pair={real:editReal.trim(),imposter:editImposter.trim()};
    setCustomQuestions(prev=>editingIdx!==null?prev.map((q,i)=>i===editingIdx?pair:q):[...prev,pair]);
    setEditReal(""); setEditImposter(""); setEditingIdx(null);
  };
  const exportJSON = () => {
    const blob=new Blob([JSON.stringify({version:1,questions:customQuestions},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob), a=document.createElement("a"); a.href=url; a.download="oddoneout-questions.json"; a.click(); URL.revokeObjectURL(url);
  };
  const importJSON = (e) => {
    setImportError(""); const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try {
        const data=JSON.parse(ev.target.result), qs=data.questions||data;
        if(!Array.isArray(qs)) throw new Error("Expected array");
        const valid=qs.filter(q=>q.real&&q.imposter);
        if(!valid.length) throw new Error("No valid pairs found");
        setCustomQuestions(prev=>{const ex=new Set(prev.map(q=>q.real+"|"+q.imposter)); return [...prev,...valid.filter(q=>!ex.has(q.real+"|"+q.imposter))];});
        setImportError(`✅ Imported ${valid.length} question${valid.length!==1?"s":""}`);
      } catch(err){setImportError("❌ "+err.message);}
    };
    reader.readAsText(file); e.target.value="";
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const isLastPass = passingPlayerIdx >= players.length - 1;
  const currentPassPlayer = players[passingPlayerIdx];
  const nextPassPlayer = players[passingPlayerIdx+1];

  return (
    <div style={S.root}>
      <style>{`@keyframes pulse{from{opacity:1}to{opacity:0.4}} * {box-sizing:border-box}`}</style>

      <header style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {phase!==PHASES.MAIN_MENU && (
            <button style={S.backBtn} onClick={()=>{stopTimer();setPhase(PHASES.MAIN_MENU);setRound(0);setRoundData(null);setPlayers(p=>p.map(x=>({...x,score:0})));HX.tap();}}>←</button>
          )}
          <span style={S.logo}>🕵️ The Odd One Out</span>
        </div>
        {round>0 && phase!==PHASES.MAIN_MENU && <span style={S.roundBadge}>Round {round} / {totalRounds}</span>}
      </header>

      <main style={S.main}>

        {/* ── MAIN MENU ── */}
        {phase===PHASES.MAIN_MENU && (
          <div style={S.menuContainer}>
            <div style={S.menuHero}>
              <div style={{fontSize:64,marginBottom:8}}>🕵️</div>
              <h1 style={S.menuTitle}>The Odd One Out</h1>
              <p style={S.menuSub}>One player got a different question. Can you spot them?</p>
            </div>
            <button style={{...S.menuBtn,background:"linear-gradient(135deg,#5C9FE0,#3a7abf)"}} onClick={()=>{HX.tap();setPhase(PHASES.LOBBY);}}>
              <span style={{fontSize:32}}>📱</span>
              <div><div style={S.menuBtnTitle}>Pass the Phone</div><div style={S.menuBtnSub}>Same device, take turns</div></div>
            </button>
            <button style={{...S.menuBtn,background:"linear-gradient(135deg,#A05CE0,#7a3abf)"}} onClick={()=>{HX.tap();setPhase(PHASES.QUESTION_EDITOR);}}>
              <span style={{fontSize:32}}>✏️</span>
              <div><div style={S.menuBtnTitle}>Custom Questions</div><div style={S.menuBtnSub}>{customQuestions.length>0?`${customQuestions.length} saved`:"Create your own pairs"}</div></div>
            </button>
            <button style={{...S.menuBtn,background:"linear-gradient(135deg,#5CCE8A,#3aaf6a)"}} onClick={()=>{HX.tap();setOnlinePhase(ONLINE_PHASES.HOME);setPhase("online");}}>
              <span style={{fontSize:32}}>🌐</span>
              <div><div style={S.menuBtnTitle}>Online</div><div style={S.menuBtnSub}>Play with friends anywhere</div></div>
            </button>
            <button style={{...S.menuBtn,background:"#1a1a2e",border:"1px solid #2a2a3a"}} onClick={()=>{HX.tap();setPhase(PHASES.SETTINGS);}}>
              <span style={{fontSize:32}}>⚙️</span>
              <div><div style={S.menuBtnTitle}>Settings</div><div style={S.menuBtnSub}>Sound, haptic, flashlight</div></div>
            </button>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {phase===PHASES.SETTINGS && (
          <div style={S.card}>
            <h2 style={S.cardTitle}>⚙️ Settings</h2>
            <Toggle value={soundEnabled} onChange={v=>{setSoundEnabled(v);soundOn=v;}} label="🔊 Sound" sub="Beeps, ticks and fanfares"/>
            <Toggle value={hapticEnabled} onChange={v=>{setHapticEnabled(v);hapticOn=v;}} label="📳 Haptic Feedback" sub="Vibration on key moments"/>
            <Toggle value={flashEnabled} onChange={v=>{setFlashEnabled(v);flashOn=v;if(v)flashTorch(1,150);}} label="🔦 Flashlight" sub="Camera torch flashes on round start and timer end"/>
            <Toggle value={ttsEnabled} onChange={v=>{setTtsEnabled(v);ttsOn=v;}} label="🔈 Read Answers Aloud" sub="Text-to-speech reads each player name and answer during discussion"/>
            <p style={{fontSize:11,color:"#444",marginTop:12,lineHeight:1.6}}>Flashlight requires camera permission. Some devices may not support it.</p>
          </div>
        )}

        {/* ── LOBBY ── */}
        {phase===PHASES.LOBBY && (
          <div style={S.card}>
            <h2 style={S.cardTitle}>📱 Pass the Phone</h2>
            <p style={S.hint}>Add players, choose your settings, then start.</p>

            <div style={S.row}>
              <input style={S.input} placeholder="Player name…" value={nameInput} maxLength={16}
                onChange={e=>setNameInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPlayer()}/>
              <button style={S.btn} onClick={addPlayer} disabled={players.length>=8}>Add</button>
            </div>
            <div style={S.playerList}>
              {players.map((p,i)=>(
                <div key={i} style={{...S.playerChip,background:p.color}}>
                  {p.name}
                  <span style={S.chipX} onClick={()=>{HX.tap();setPlayers(prev=>prev.filter((_,j)=>j!==i));}}>✕</span>
                </div>
              ))}
            </div>
            {players.length<3&&<p style={S.warn}>Need at least 3 players (max 8).</p>}

            <hr style={S.divider}/>
            <h3 style={S.settingsTitle}>⚙️ Game Settings</h3>

            {/* Game mode */}
            <label style={S.label}>Game Mode</label>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[{k:MODES.QUESTIONER,icon:"❓",title:"Questioner",sub:"One person guesses"},{k:MODES.VOTE,icon:"🗳️",title:"Everyone Votes",sub:"Majority rules"}].map(m=>(
                <div key={m.k} style={{...S.modeCard,borderColor:gameMode===m.k?"#5C9FE0":"#2a2a3a",background:gameMode===m.k?"#1a1a2e":"#16161e"}}
                  onClick={()=>{HX.tap();setGameMode(m.k);}}>
                  <div style={{fontSize:24,marginBottom:4}}>{m.icon}</div>
                  <div style={{fontWeight:700,fontSize:13,color:gameMode===m.k?"#5C9FE0":"#ccc"}}>{m.title}</div>
                  <div style={{fontSize:11,color:"#555",marginTop:2}}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* Category */}
            <label style={S.label}>Category</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
              {Object.entries(CATEGORIES).map(([k,v])=>(
                <button key={k} style={{...S.timerChip,...(selectedCategory===k?{background:v.color+"22",borderColor:v.color,color:v.color,fontWeight:700}:{})}}
                  onClick={()=>{HX.tap();setSelectedCategory(k);}}>{v.label}</button>
              ))}
            </div>

            {/* Rounds */}
            <label style={S.label}>Rounds: <strong style={{color:"#5C9FE0"}}>{totalRounds}</strong></label>
            <div style={S.sliderRow}>
              <span style={S.sliderEnd}>6</span>
              <input type="range" min={6} max={30} value={totalRounds} style={S.slider} onChange={e=>setTotalRounds(+e.target.value)}/>
              <span style={S.sliderEnd}>30</span>
            </div>

            {/* Timer */}
            <label style={S.label}>Discussion Timer</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
              {TIMER_OPTIONS.map(o=>(
                <button key={o.value} style={{...S.timerChip,...(discussionTime===o.value?S.timerChipActive:{})}}
                  onClick={()=>{HX.tap();setDiscussionTime(o.value);}}>{o.label}</button>
              ))}
            </div>

            <button style={{...S.bigBtn,background:"#2a2a3a",border:"1px solid #3a3a5a",marginBottom:8}}
              onClick={()=>{HX.tap();setPhase(PHASES.QUESTION_EDITOR);}}>
              ✏️ Custom Questions {customQuestions.length>0?`(${customQuestions.length})`:""}
            </button>
            <button style={{...S.bigBtn,opacity:players.length<3?0.4:1}} onClick={()=>players.length>=3&&beginRound(players,0)} disabled={players.length<3}>
              Start Game →
            </button>
          </div>
        )}

        {/* ── QUESTION EDITOR ── */}
        {phase===PHASES.QUESTION_EDITOR&&(()=>{
          const cancelEdit=()=>{setEditReal("");setEditImposter("");setEditingIdx(null);};
          const startEdit=(i)=>{setEditReal(customQuestions[i].real);setEditImposter(customQuestions[i].imposter);setEditingIdx(i);};
          return (
            <div style={S.card}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                <button style={{...S.btn,background:"#2a2a3a",padding:"6px 12px",fontSize:13}} onClick={()=>{cancelEdit();setPhase(PHASES.MAIN_MENU);}}>← Back</button>
                <h2 style={{...S.cardTitle,margin:0,flex:1}}>✏️ Custom Questions</h2>
              </div>
              <p style={S.hint}>Add pairs: one real question everyone sees, one slightly different question only the Odd One Out sees.</p>
              <div style={S.editorForm}>
                <label style={{...S.label,color:"#5C9FE0"}}>Real question (everyone)</label>
                <textarea style={{...S.input,resize:"none",minHeight:60,marginBottom:8,fontFamily:"inherit",lineHeight:1.5}}
                  placeholder="e.g. Describe your perfect Sunday morning." value={editReal} onChange={e=>setEditReal(e.target.value)}/>
                <label style={{...S.label,color:"#A05CE0"}}>Odd One Out's question (subtly different)</label>
                <textarea style={{...S.input,resize:"none",minHeight:60,marginBottom:10,fontFamily:"inherit",lineHeight:1.5,borderColor:"#A05CE044"}}
                  placeholder="e.g. Describe your perfect Saturday night." value={editImposter} onChange={e=>setEditImposter(e.target.value)}/>
                <div style={S.row}>
                  <button style={{...S.bigBtn,flex:1,margin:0,opacity:(!editReal.trim()||!editImposter.trim())?0.4:1}}
                    onClick={saveEdit} disabled={!editReal.trim()||!editImposter.trim()}>
                    {editingIdx!==null?"💾 Save Changes":"➕ Add Question"}
                  </button>
                  {editingIdx!==null&&<button style={{...S.btn,background:"#2a2a3a"}} onClick={cancelEdit}>Cancel</button>}
                </div>
              </div>
              {customQuestions.length>0&&(
                <div style={S.toggleRow} onClick={()=>setUseCustomOnly(v=>!v)}>
                  <div style={{width:38,height:22,borderRadius:11,background:useCustomOnly?"#5C9FE0":"#2a2a3a",position:"relative",transition:"background 0.2s",flexShrink:0}}>
                    <div style={{position:"absolute",top:3,left:useCustomOnly?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
                  </div>
                  <span style={{fontSize:14,color:"#ccc"}}>Use custom questions only</span>
                </div>
              )}
              {customQuestions.length===0?(
                <p style={{color:"#444",fontSize:13,textAlign:"center",marginTop:16}}>No custom questions yet.</p>
              ):(
                <>
                  <h3 style={S.sectionTitle}>Saved ({customQuestions.length})</h3>
                  {customQuestions.map((q,i)=>(
                    <div key={i} style={S.questionCard}>
                      <div style={{fontSize:13,color:"#5C9FE0",marginBottom:3}}>Real: <span style={{color:"#ccc"}}>{q.real}</span></div>
                      <div style={{fontSize:13,color:"#A05CE0",marginBottom:8}}>Odd One Out: <span style={{color:"#ccc"}}>{q.imposter}</span></div>
                      <div style={{display:"flex",gap:6}}>
                        <button style={{...S.btn,fontSize:12,padding:"4px 10px",background:"#2a2a3a"}} onClick={()=>startEdit(i)}>✏️ Edit</button>
                        <button style={{...S.btn,fontSize:12,padding:"4px 10px",background:"#3a1a1a",color:"#E05C5C"}} onClick={()=>setCustomQuestions(prev=>prev.filter((_,j)=>j!==i))}>🗑 Delete</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              <hr style={S.divider}/>
              <h3 style={S.sectionTitle}>Import / Export</h3>
              <div style={{display:"flex",gap:8}}>
                <button style={{...S.btn,background:"#2a2a3a",flex:1}} onClick={exportJSON} disabled={customQuestions.length===0}>⬇️ Export JSON</button>
                <button style={{...S.btn,background:"#2a2a3a",flex:1}} onClick={()=>fileInputRef.current?.click()}>⬆️ Import JSON</button>
                <input ref={fileInputRef} type="file" accept=".json" style={{display:"none"}} onChange={importJSON}/>
              </div>
              {importError&&<p style={{fontSize:13,marginTop:8,color:importError.startsWith("✅")?"#5CCE8A":"#E05C5C"}}>{importError}</p>}
            </div>
          );
        })()}

        {/* ── ROUND START ── */}
        {phase===PHASES.ROUND_START&&roundData&&(
          <HandoffCard
            icon="🎲"
            title={`Round ${round} of ${totalRounds}`}
            hint={gameMode===MODES.VOTE
              ? `Everyone gets the phone once — see your secret role and write your answer. There is no questioner this round, everyone answers!\n\nFirst up:`
              : `Everyone gets the phone once — see your secret role and write your answer privately.\n\nFirst up:`}
            btnLabel={`Pass the phone to ${players[0]?.name} →`}
            btnColor="#5C9FE0"
            onTap={()=>{HX.confirm();SFX.confirm();setPhase(PHASES.PASSING);}}
            sub={null}
          />
        )}

        {/* ── PASSING ── */}
        {phase===PHASES.PASSING&&roundData&&(()=>{
          const player=currentPassPlayer;
          const isQ=passingPlayerIdx===roundData.questionerIdx;
          const isImp=passingPlayerIdx===roundData.imposterIdx;
          const topic=isImp?roundData.pair.imposter:roundData.pair.real;

          if (passingStep==="done") return (
            <HandoffCard icon="✅" title="Everyone's done!"
              hint="Time to discuss out loud — put the phone where everyone can see the answers."
              btnLabel="🗣️ Start Discussion" btnColor="#5CCE8A" onTap={onStartDiscussion}/>
          );

          if (passingStep==="waiting") return (
            <div style={S.handoffCard}>
              <div style={{fontSize:60,marginBottom:12}}>📵</div>
              <h2 style={S.handoffTitle}>Pass to <span style={{color:player?.color}}>{player?.name}</span></h2>
              <p style={S.handoffHint}>Hand the phone face-down to <strong style={{color:player?.color}}>{player?.name}</strong></p>
              <div style={{background:"#1a1a2e",border:`2px solid ${player?.color}`,borderRadius:14,padding:"14px 20px",marginBottom:20,alignSelf:"stretch",textAlign:"center"}}>
                <div style={{fontSize:12,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Tap when you have it</div>
                <div style={{fontSize:18,fontWeight:700,color:player?.color}}>✋ I'm {player?.name}</div>
              </div>
              <button style={{...S.bigBtn,background:"#5CCE8A",fontSize:17,padding:16}} onClick={onPassReceived}>
                I got it — I'm {player?.name}
              </button>
              <p style={{fontSize:12,color:"#444",textAlign:"center",marginTop:12}}>Player {passingPlayerIdx+1} of {players.length}</p>
            </div>
          );

          // "role" step
          return (
            <div style={S.card}>
              <p style={S.passNotice}>👀 Only <strong style={{color:player?.color}}>{player?.name}</strong> should be looking</p>
              <div style={S.secretBox}>
                <p style={S.secretLabel}>Your role this round:</p>
                {isQ?(
                  <>
                    <div style={S.roleBadge("#E05C5C")}>❓ QUESTIONER</div>
                    <p style={S.secretText}>Listen to everyone's answers. Figure out who answered something subtly different — that's the Odd One Out.</p>
                    <div style={S.topicBox}><span style={S.topicLabel}>The question everyone was asked:</span><span style={S.topicText}>"{roundData.pair.real}"</span></div>
                  </>
                ):isImp?(
                  <>
                    <div style={S.roleBadge("#A05CE0")}>👻 ODD ONE OUT</div>
                    <p style={S.secretText}>Your topic is <em>different</em> from everyone else's. Answer convincingly — don't give yourself away!</p>
                    <div style={{...S.topicBox,borderColor:"#A05CE0"}}><span style={S.topicLabel}>Your topic (different from theirs!):</span><span style={S.topicText}>"{topic}"</span></div>
                  </>
                ):(
                  <>
                    <div style={S.roleBadge("#5C9FE0")}>✅ PLAYER</div>
                    <p style={S.secretText}>{gameMode===MODES.VOTE
                      ? "Answer honestly. After discussion, everyone votes on who they think got a different question."
                      : "Answer honestly. During discussion, try to spot who gave a different answer."}</p>
                    <div style={S.topicBox}><span style={S.topicLabel}>Your topic:</span><span style={S.topicText}>"{topic}"</span></div>
                  </>
                )}
              </div>
              {isQ?(
                <button style={{...S.bigBtn,background:"#E0C15C",color:"#1a1a00"}} onClick={()=>onSubmitAndPass("",true)}>
                  {isLastPass?"Done →":`Got it — Pass to ${nextPassPlayer?.name} →`}
                </button>
              ):(
                <>
                  <input style={{...S.input,marginBottom:10,width:"100%"}} placeholder="Type your answer…"
                    value={answerInput} onChange={e=>setAnswerInput(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&onSubmitAndPass(answerInput,false)} autoFocus/>
                  <button style={{...S.bigBtn,background:"#E0C15C",color:"#1a1a00",opacity:!answerInput.trim()?0.4:1}}
                    disabled={!answerInput.trim()} onClick={()=>onSubmitAndPass(answerInput,false)}>
                    {isLastPass?"Submit →":`Submit & Pass to ${nextPassPlayer?.name} →`}
                  </button>
                </>
              )}
              <p style={{fontSize:12,color:"#444",textAlign:"center",marginTop:10}}>Player {passingPlayerIdx+1} of {players.length}</p>
            </div>
          );
        })()}

        {/* ── DISCUSSION ── */}
        {phase===PHASES.DISCUSSION&&roundData&&(
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <h2 style={{...S.cardTitle,margin:0}}>🗣️ Discuss Out Loud</h2>
              <button style={{...S.btn,padding:"6px 12px",fontSize:12,background:timerRunning?"#E05C5C":"#5CCE8A"}}
                onClick={()=>timerRunning?stopTimer():setTimerRunning(true)}>
                {timerRunning?"⏸ Pause":"▶ Resume"}
              </button>
            </div>
            <TimerRing seconds={timerSec} total={discussionTime}/>
            <div style={S.questionReminder}>
              <span style={S.questionReminderLabel}>❓ The question was</span>
              <span style={S.questionReminderText}>"{roundData.pair.real}"</span>
            </div>
            <p style={S.hint}>Talk it out — who sounds like they answered something different?</p>
            <div style={S.answersGrid}>
              {Object.entries(roundData.answers).map(([idx,ans])=>{
                const p=players[+idx];
                return (<div key={idx} style={S.answerCard}><div style={{...S.answerName,color:p.color}}>{p.name}</div><div style={S.answerText}>"{ans}"</div></div>);
              })}
            </div>
            {ttsEnabled && (
              <div style={{display:"flex",gap:8,marginTop:4,marginBottom:4}}>
                <button style={{...S.bigBtn,flex:3,background:"#2a2a3a",border:"1px solid #3a3a5a"}}
                  onClick={()=>TTS.readAnswers(roundData.answers, players)}>
                  🔈 Read Answers Aloud
                </button>
                <button style={{...S.bigBtn,flex:1,background:"#2a2a3a",border:"1px solid #3a3a5a",padding:"14px 8px"}}
                  onClick={()=>TTS.stop()}>
                  ⏹
                </button>
              </div>
            )}
            <button style={{...S.bigBtn,background:"#E05C5C",marginTop:4}}
              onClick={()=>{stopTimer();setPhase(gameMode===MODES.VOTE?PHASES.VOTING:PHASES.ACCUSE);}}>
              {gameMode===MODES.VOTE?"🗳️ Start Voting →":"❓ Ready to Accuse →"}
            </button>
          </div>
        )}

        {/* ── ACCUSE (Questioner mode) ── */}
        {phase===PHASES.ACCUSE&&roundData&&(
          <div style={S.card}>
            <h2 style={S.cardTitle}>🔍 Who's the Odd One Out?</h2>
            <p style={S.hint}><strong style={{color:players[roundData.questionerIdx]?.color}}>{players[roundData.questionerIdx]?.name}</strong>, pick your suspect.</p>
            {players.map((p,i)=>{
              if (i===roundData.questionerIdx) return null;
              return (
                <div key={i} style={{...S.suspectRow,border:accuseTarget===i?`2px solid ${p.color}`:"2px solid #2a2a3a",background:accuseTarget===i?"#1e1e2e":"#16161e"}}
                  onClick={()=>{HX.tap();setAccuseTarget(i);}}>
                  <span style={{...S.dot,background:p.color,width:18,height:18}}/>
                  <span style={{fontWeight:600,color:"#e0e0e0"}}>{p.name}</span>
                  {accuseTarget===i&&<span style={{marginLeft:"auto",color:p.color}}>◀ suspect</span>}
                </div>
              );
            })}
            <button style={{...S.bigBtn,background:"#E05C5C",opacity:accuseTarget===null?0.4:1,marginTop:8}}
              disabled={accuseTarget===null} onClick={accuse}>
              Accuse {accuseTarget!==null?players[accuseTarget]?.name:"…"}
            </button>
          </div>
        )}

        {/* ── VOTING ── */}
        {phase===PHASES.VOTING&&roundData&&(()=>{
          const voter = players[votingPlayerIdx];
          const voteTally = {};
          Object.values(votes).forEach(t=>{ voteTally[t]=(voteTally[t]||0)+1; });

          // Done — show tally and reveal button
          if (votingStep==="done") return (
            <div style={S.card}>
              <h2 style={S.cardTitle}>🗳️ All Votes In</h2>
              <p style={S.hint}>Here is how the votes landed. Ready to reveal?</p>
              <div style={S.answersGrid}>
                {players.map((p,i)=>{
                  const count = voteTally[i]||0;
                  const maxVotes = Math.max(...Object.values(voteTally),0);
                  const isLeading = count>0 && count===maxVotes;
                  return (
                    <div key={i} style={{...S.answerCard,borderColor:isLeading?"#E05C5C":"#2a2a3a",background:isLeading?"#2a1a1a":"#1e1e2e"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{...S.dot,background:p.color,width:14,height:14}}/>
                        <span style={{fontWeight:700,color:p.color}}>{p.name}</span>
                        <span style={{marginLeft:"auto",fontWeight:700,fontSize:18,color:isLeading?"#E05C5C":"#aaa"}}>{count} {count===1?"vote":"votes"}</span>
                      </div>
                      {count>0&&(
                        <div style={{height:6,borderRadius:3,background:"#2a2a3a",overflow:"hidden",marginTop:4}}>
                          <div style={{height:"100%",borderRadius:3,background:isLeading?"#E05C5C":p.color,width:`${(count/players.length)*100}%`,transition:"width 0.4s"}}/>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button style={{...S.bigBtn,background:"#E05C5C",marginTop:4}} onClick={tallyVotes}>
                Reveal Who It Was →
              </button>
            </div>
          );

          // Waiting — blank handoff screen
          if (votingStep==="waiting") return (
            <div style={S.handoffCard}>
              <div style={{fontSize:60,marginBottom:12}}>🗳️</div>
              <h2 style={S.handoffTitle}>Pass to <span style={{color:voter?.color}}>{voter?.name}</span></h2>
              <p style={S.handoffHint}>Hand the phone face-down — only <strong style={{color:voter?.color}}>{voter?.name}</strong> taps next.</p>
              <button style={{...S.bigBtn,background:"#5CCE8A",fontSize:17,padding:16,marginTop:8}} onClick={onVoteReceived}>
                ✋ I got it — I am {voter?.name}
              </button>
              <p style={{fontSize:12,color:"#444",textAlign:"center",marginTop:12}}>Voter {votingPlayerIdx+1} of {players.length}</p>
            </div>
          );

          // Voting — current player picks their suspect privately
          return (
            <div style={S.card}>
              <p style={S.passNotice}>🗳️ Only <strong style={{color:voter?.color}}>{voter?.name}</strong> should be looking</p>
              <div style={S.secretBox}>
                <p style={S.secretLabel}>Who do you think got a different question?</p>
                <p style={S.secretText}>Tap your suspect. Your vote is private — no one else can see it.</p>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
                {players.map((p,i)=>{
                  if (i===votingPlayerIdx) return null;
                  return (
                    <div key={i}
                      style={{...S.suspectRow,border:`2px solid ${p.color}44`,background:"#16161e"}}
                      onClick={()=>castVoteAndPass(i)}>
                      <span style={{...S.dot,background:p.color,width:18,height:18}}/>
                      <span style={{fontWeight:600,color:"#e0e0e0",fontSize:16}}>{p.name}</span>
                      <span style={{marginLeft:"auto",color:p.color,fontSize:20}}>→</span>
                    </div>
                  );
                })}
              </div>
              <p style={{fontSize:12,color:"#444",textAlign:"center"}}>Voter {votingPlayerIdx+1} of {players.length}</p>
            </div>
          );
        })()}

        {/* ── REVEAL ── */}
        {phase===PHASES.REVEAL&&roundData&&(
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h2 style={{...S.cardTitle,margin:0}}>📋 Round {round} Over</h2>
              <span style={S.roundBadge}>{round}/{totalRounds}</span>
            </div>
            {roundData.accusedIdx===roundData.imposterIdx?(
              <div style={S.resultBanner("#5CCE8A")}>✅ Correct! <strong>{players[roundData.imposterIdx]?.name}</strong> was the Odd One Out!{gameMode===MODES.QUESTIONER&&<><br/><small>{players[roundData.questionerIdx]?.name} earns 2 pts</small></>}</div>
            ):(
              <div style={S.resultBanner("#E05C5C")}>👻 Wrong! <strong>{players[roundData.imposterIdx]?.name}</strong> fooled everyone!<br/><small>{players[roundData.imposterIdx]?.name} earns 3 pts</small></div>
            )}
            {gameMode===MODES.VOTE&&roundData.voteTally&&(
              <div style={{marginBottom:12}}>
                <h3 style={S.sectionTitle}>Vote Breakdown</h3>
                {players.map((p,i)=>{
                  const count=roundData.voteTally[i]||0; if(!count) return null;
                  return (<div key={i} style={S.scoreRow}><span style={{color:p.color,fontWeight:700}}>{p.name}</span><span style={S.scoreNum}>{count} vote{count!==1?"s":""}</span></div>);
                })}
              </div>
            )}
            <div style={S.revealGrid}>
              <div style={S.revealItem}><span style={S.revealLabel}>Real question</span><span style={S.revealValue}>"{roundData.pair.real}"</span></div>
              <div style={S.revealItem}><span style={S.revealLabel}>Odd One Out's question</span><span style={{...S.revealValue,color:"#A05CE0"}}>"{roundData.pair.imposter}"</span></div>
            </div>
            <h3 style={S.sectionTitle}>Answers</h3>
            {Object.entries(roundData.answers).map(([idx,ans])=>{
              const p=players[+idx],isImp=+idx===roundData.imposterIdx;
              return (<div key={idx} style={{...S.answerCard,borderColor:isImp?"#A05CE0":"#2a2a3a"}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{color:p.color,fontWeight:700}}>{p.name}</span>{isImp&&<span style={S.impBadge}>👻 ODD ONE OUT</span>}</div><div style={S.answerText}>"{ans}"</div></div>);
            })}
            <h3 style={S.sectionTitle}>Scores</h3>
            {[...players].sort((a,b)=>b.score-a.score).map((p,i)=>(
              <div key={i} style={S.scoreRow}><span style={{color:p.color,fontWeight:700}}>{p.name}</span><span style={S.scoreNum}>{p.score} pts</span></div>
            ))}
            <button style={{...S.bigBtn,marginTop:12}} onClick={nextRound}>
              {isLastRound?"See Final Scores 🏆":"Next Round →"}
            </button>
          </div>
        )}

        {/* ── SCOREBOARD ── */}
        {phase===PHASES.SCOREBOARD&&(
          <div style={S.card}>
            <h2 style={S.cardTitle}>🏆 Final Scores</h2>
            <p style={S.hint}>After {totalRounds} rounds</p>
            {[...players].sort((a,b)=>b.score-a.score).map((p,i)=>(
              <div key={i} style={S.finalScoreRow}>
                <span style={S.rank}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`}</span>
                <span style={{color:p.color,fontWeight:700,fontSize:18}}>{p.name}</span>
                <span style={S.scoreNum}>{p.score} pts</span>
              </div>
            ))}
            <button style={{...S.bigBtn,marginTop:20}} onClick={resetGame}>Back to Menu</button>
          </div>
        )}

      {/* ── ONLINE MODE ── */}
        {phase==="online" && (()=>{
          const me = onlinePlayers.find(p=>p.id===myId);
          const isVote = onlineSettings.mode === MODES.VOTE;

          // ── HOME ──────────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.HOME) return (
            <div style={S.card}>
              <h2 style={S.cardTitle}>🌐 Online Play</h2>
              {onlineError && <p style={{color:"#E05C5C",fontSize:13,marginBottom:10}}>⚠️ {onlineError}</p>}
              <p style={S.hint}>Create a private room or join a friend's room by code. Everyone plays on their own phone.</p>
              <button style={{...S.bigBtn,marginBottom:8}} onClick={()=>setOnlinePhase(ONLINE_PHASES.CREATING)}>➕ Create Room</button>
              <button style={{...S.bigBtn,background:"#2a2a3a",border:"1px solid #3a3a5a",marginBottom:8}} onClick={()=>setOnlinePhase(ONLINE_PHASES.JOINING)}>🔑 Join by Code</button>
              <button style={{...S.bigBtn,background:"#2a2a3a",border:"1px solid #3a3a5a"}} onClick={()=>{connectAndSend("list_rooms",{});setOnlinePhase(ONLINE_PHASES.BROWSE);}}>🌍 Browse Public Rooms</button>
            </div>
          );

          // ── CREATE ────────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.CREATING) return (
            <div style={S.card}>
              <h2 style={S.cardTitle}>➕ Create Room</h2>
              {onlineError && <p style={{color:"#E05C5C",fontSize:13,marginBottom:10}}>⚠️ {onlineError}</p>}
              <label style={S.label}>Your name</label>
              <input style={{...S.input,marginBottom:12}} placeholder="Your name…" value={createName} onChange={e=>setCreateName(e.target.value)} maxLength={16}/>
              <label style={S.label}>Room name (optional)</label>
              <input style={{...S.input,marginBottom:12}} placeholder="e.g. Dave's Birthday" value={createRoomName} onChange={e=>setCreateRoomName(e.target.value)} maxLength={30}/>
              <label style={S.label}>Password (leave blank for public)</label>
              <input style={{...S.input,marginBottom:16}} placeholder="Optional password…" value={createPassword} onChange={e=>setCreatePassword(e.target.value)} maxLength={20} type="password"/>
              <hr style={S.divider}/>
              <h3 style={S.settingsTitle}>Game Settings</h3>
              <label style={S.label}>Mode</label>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                {[{k:"questioner",icon:"❓",t:"Questioner"},{k:"vote",icon:"🗳️",t:"Everyone Votes"}].map(m=>(
                  <div key={m.k} style={{...S.modeCard,flex:1,borderColor:onlineSettings.mode===m.k?"#5C9FE0":"#2a2a3a",background:onlineSettings.mode===m.k?"#1a1a2e":"#16161e"}}
                    onClick={()=>setOnlineSettings(s=>({...s,mode:m.k}))}>
                    <div style={{fontSize:22,marginBottom:4}}>{m.icon}</div>
                    <div style={{fontWeight:700,fontSize:12,color:onlineSettings.mode===m.k?"#5C9FE0":"#ccc"}}>{m.t}</div>
                  </div>
                ))}
              </div>
              <label style={S.label}>Category</label>
              <select style={{...S.input,marginBottom:12}} value={onlineSettings.category} onChange={e=>setOnlineSettings(s=>({...s,category:e.target.value}))}>
                {Object.entries({"all":"🎲 All","food":"🍕 Food","popculture":"🎬 Pop Culture","travel":"✈️ Travel","history":"📜 History","science":"🔬 Science","mystery":"🔍 Mystery","gaming":"🎮 Gaming","sport":"🏆 Sport","spicy":"🌶️ Spicy"}).map(([k,v])=>(
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <label style={S.label}>Rounds: <strong style={{color:"#5C9FE0"}}>{onlineSettings.totalRounds}</strong></label>
              <div style={S.sliderRow}>
                <span style={S.sliderEnd}>6</span>
                <input type="range" min={6} max={30} value={onlineSettings.totalRounds} style={S.slider} onChange={e=>setOnlineSettings(s=>({...s,totalRounds:+e.target.value}))}/>
                <span style={S.sliderEnd}>30</span>
              </div>
              <label style={S.label}>Discussion Timer</label>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
                {[{l:"30s",v:30},{l:"1m",v:60},{l:"90s",v:90},{l:"2m",v:120},{l:"3m",v:180}].map(o=>(
                  <button key={o.v} style={{...S.timerChip,...(onlineSettings.discussionTime===o.v?S.timerChipActive:{})}} onClick={()=>setOnlineSettings(s=>({...s,discussionTime:o.v}))}>{o.l}</button>
                ))}
              </div>
              <button style={{...S.bigBtn,opacity:!createName.trim()?0.4:1}} disabled={!createName.trim()}
                onClick={()=>connectAndSend("create_room",{playerName:createName,roomName:createRoomName,password:createPassword,settings:onlineSettings})}>
                Create Room →
              </button>
            </div>
          );

          // ── JOIN ──────────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.JOINING) return (
            <div style={S.card}>
              <h2 style={S.cardTitle}>🔑 Join Room</h2>
              {onlineError && <p style={{color:"#E05C5C",fontSize:13,marginBottom:10}}>⚠️ {onlineError}</p>}
              <label style={S.label}>Your name</label>
              <input style={{...S.input,marginBottom:12}} placeholder="Your name…" value={joinName} onChange={e=>setJoinName(e.target.value)} maxLength={16}/>
              <label style={S.label}>Room code</label>
              <input style={{...S.input,marginBottom:12}} placeholder="e.g. XK92PL" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={6}/>
              <label style={S.label}>Password (if required)</label>
              <input style={{...S.input,marginBottom:16}} placeholder="Leave blank if none" value={joinPassword} onChange={e=>setJoinPassword(e.target.value)} type="password"/>
              <button style={{...S.bigBtn,opacity:(!joinName.trim()||joinCode.length<6)?0.4:1}} disabled={!joinName.trim()||joinCode.length<6}
                onClick={()=>connectAndSend("join_room",{playerName:joinName,roomCode:joinCode,password:joinPassword})}>
                Join →
              </button>
            </div>
          );

          // ── BROWSE ────────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.BROWSE) return (
            <div style={S.card}>
              <h2 style={S.cardTitle}>🌍 Public Rooms</h2>
              {onlineError && <p style={{color:"#E05C5C",fontSize:13,marginBottom:10}}>⚠️ {onlineError}</p>}
              <label style={S.label}>Your name (to join)</label>
              <input style={{...S.input,marginBottom:12}} placeholder="Your name…" value={joinName} onChange={e=>setJoinName(e.target.value)} maxLength={16}/>
              {publicRooms.length===0 ? (
                <p style={{color:"#555",textAlign:"center",padding:"24px 0"}}>No public rooms right now.<br/>Create one and invite friends!</p>
              ) : publicRooms.map(r=>(
                <div key={r.code} style={{...S.answerCard,marginBottom:8,cursor:"pointer"}} onClick={()=>{if(!joinName.trim()){setOnlineError("Enter your name first");return;} connectAndSend("join_room",{playerName:joinName,roomCode:r.code,password:""});}}>
                  <div style={{fontWeight:700,color:"#e0e0e0",marginBottom:4}}>{r.name}</div>
                  <div style={{display:"flex",gap:12,fontSize:12,color:"#888"}}>
                    <span>👥 {r.playerCount}/8</span>
                    <span>🔢 {r.code}</span>
                    <span>{r.settings?.category || "all"}</span>
                  </div>
                </div>
              ))}
              <button style={{...S.bigBtn,background:"#2a2a3a",border:"1px solid #3a3a5a",marginTop:8}} onClick={()=>connectAndSend("list_rooms",{})}>🔄 Refresh</button>
            </div>
          );

          // ── WAITING LOBBY ─────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.WAITING) return (
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <h2 style={{...S.cardTitle,margin:0}}>{roomName}</h2>
                  <div style={{fontSize:13,color:"#666",marginTop:4}}>Code: <strong style={{color:"#5C9FE0",letterSpacing:2}}>{roomCode}</strong></div>
                </div>
                <button style={{...S.btn,background:"#2a2a3a",padding:"6px 12px",fontSize:12}} onClick={leaveOnline}>Leave</button>
              </div>
              <div style={S.playerList}>
                {onlinePlayers.map(p=>(
                  <div key={p.id} style={{...S.playerChip,background:p.color,opacity:p.connected?1:0.4}}>
                    {p.name}{p.isHost?" 👑":""}{!p.connected?" (away)":""}
                    {isHost && !p.isHost && <span style={S.chipX} onClick={()=>sendToServer("kick_player",{playerId:p.id})}>✕</span>}
                  </div>
                ))}
              </div>
              <div style={{...S.questionReminder,marginBottom:12}}>
                <span style={S.questionReminderLabel}>Settings</span>
                <span style={{...S.questionReminderText,fontStyle:"normal",fontSize:13}}>
                  {onlineSettings.mode==="vote"?"🗳️ Vote":"❓ Questioner"} · {onlineSettings.totalRounds} rounds · {onlineSettings.category}
                </span>
              </div>
              {onlinePlayers.length<3 && <p style={S.warn}>Need at least 3 players to start.</p>}
              {isHost ? (
                <button style={{...S.bigBtn,opacity:onlinePlayers.length<3?0.4:1}} disabled={onlinePlayers.length<3}
                  onClick={()=>sendToServer("start_game")}>
                  Start Game →
                </button>
              ) : (
                <p style={{textAlign:"center",color:"#666",fontSize:14,padding:"16px 0"}}>⏳ Waiting for host to start…</p>
              )}
            </div>
          );

          // ── ROLE REVEAL ───────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.ROLE_REVEAL) return (
            <div style={S.card}>
              <div style={{textAlign:"center",fontSize:12,color:"#666",marginBottom:12}}>Round {onlineRound} of {onlineTotalRounds}</div>
              <div style={S.secretBox}>
                <p style={S.secretLabel}>Your role this round:</p>
                {myRole==="questioner" ? (
                  <>
                    <div style={S.roleBadge("#E05C5C")}>❓ QUESTIONER</div>
                    <p style={S.secretText}>Listen to everyone's answers and figure out who got a different question.</p>
                    <div style={S.topicBox}><span style={S.topicLabel}>The question:</span><span style={S.topicText}>"{myTopic}"</span></div>
                  </>
                ) : myRole==="impostor" ? (
                  <>
                    <div style={S.roleBadge("#A05CE0")}>👻 ODD ONE OUT</div>
                    <p style={S.secretText}>Your question is different. Answer convincingly!</p>
                    <div style={{...S.topicBox,borderColor:"#A05CE0"}}><span style={S.topicLabel}>Your question (different!):</span><span style={S.topicText}>"{myTopic}"</span></div>
                  </>
                ) : (
                  <>
                    <div style={S.roleBadge("#5C9FE0")}>✅ PLAYER</div>
                    <p style={S.secretText}>Answer honestly. Try to spot who got a different question.</p>
                    <div style={S.topicBox}><span style={S.topicLabel}>Your question:</span><span style={S.topicText}>"{myTopic}"</span></div>
                  </>
                )}
              </div>
              <p style={{fontSize:12,color:"#555",textAlign:"center",marginBottom:10}}>
                {readyCount} / {onlinePlayers.length} ready
              </p>
              <button style={{...S.bigBtn,background:"#E0C15C",color:"#1a1a00"}}
                onClick={()=>{ SFX.confirm(); sendToServer("player_ready"); }}>
                Got it — I'm Ready ✓
              </button>
            </div>
          );

          // ── ANSWERING ─────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.ANSWERING) return (
            <div style={S.card}>
              <div style={{textAlign:"center",fontSize:12,color:"#666",marginBottom:8}}>Round {onlineRound} of {onlineTotalRounds}</div>
              {myRole==="questioner" ? (
                <div style={S.secretBox}>
                  <div style={S.roleBadge("#E05C5C")}>❓ QUESTIONER</div>
                  <p style={S.secretText}>Everyone else is answering. Watch their faces!</p>
                  <div style={S.topicBox}><span style={S.topicLabel}>The question:</span><span style={S.topicText}>"{myTopic}"</span></div>
                  <p style={{fontSize:12,color:"#666",marginTop:8}}>{answeredIds.length} / {onlinePlayers.length-1} answered</p>
                </div>
              ) : (
                <>
                  <div style={S.secretBox}>
                    <p style={S.secretLabel}>Answer this question:</p>
                    <div style={S.topicBox}><span style={S.topicText}>"{myTopic}"</span></div>
                  </div>
                  <input style={{...S.input,marginBottom:10,width:"100%"}} placeholder="Type your answer…" value={myAnswer}
                    onChange={e=>setMyAnswer(e.target.value)}
                    onKeyDown={e=>{ if(e.key==="Enter"&&myAnswer.trim()){ SFX.submit(); sendToServer("submit_answer",{answer:myAnswer}); setOnlinePhase("online_answering_sent"); }}}
                    autoFocus/>
                  <button style={{...S.bigBtn,background:"#E0C15C",color:"#1a1a00",opacity:!myAnswer.trim()?0.4:1}}
                    disabled={!myAnswer.trim()}
                    onClick={()=>{ SFX.submit(); sendToServer("submit_answer",{answer:myAnswer}); setOnlinePhase("online_answering_sent"); }}>
                    Submit Answer →
                  </button>
                </>
              )}
            </div>
          );

          // ── ANSWER SENT — waiting for others ─────────────────────────────
          if (onlinePhase==="online_answering_sent") return (
            <div style={S.handoffCard}>
              <div style={{fontSize:56,marginBottom:12}}>⏳</div>
              <h2 style={S.handoffTitle}>Answer submitted!</h2>
              <p style={S.handoffHint}>Waiting for everyone else…</p>
              <p style={{fontSize:13,color:"#555"}}>{answeredIds.length} / {onlinePlayers.filter(p=>p.id!==onlinePlayers.find(x=>x.id===myId&&myRole==="questioner")?.id).length || onlinePlayers.length-1} answered</p>
            </div>
          );

          // ── DISCUSSION ────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.DISCUSSION) return (
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <h2 style={{...S.cardTitle,margin:0}}>🗣️ Discuss!</h2>
                {isHost && (
                  <button style={{...S.btn,padding:"6px 12px",fontSize:12,background:"#E05C5C"}} onClick={()=>sendToServer("stop_timer")}>
                    Skip Timer
                  </button>
                )}
              </div>
              <TimerRing seconds={onlineTimerSec} total={onlineTimerTotal}/>
              <div style={S.questionReminder}>
                <span style={S.questionReminderLabel}>❓ The question was</span>
                <span style={S.questionReminderText}>"{realQuestion}"</span>
              </div>
              <div style={S.answersGrid}>
                {Object.entries(onlineAnswers).map(([pid,ans])=>{
                  const p=onlinePlayers.find(x=>x.id===pid);
                  if(!p) return null;
                  return (<div key={pid} style={S.answerCard}><div style={{...S.answerName,color:p.color}}>{p.name}</div><div style={S.answerText}>"{ans}"</div></div>);
                })}
              </div>
              {ttsEnabled && (
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button style={{...S.bigBtn,flex:3,background:"#2a2a3a",border:"1px solid #3a3a5a"}}
                    onClick={()=>TTS.readAnswers(onlineAnswers, onlinePlayers.reduce((acc,p)=>{acc[p.id]=p;return acc;},{})
                    )}>🔈 Read Aloud</button>
                  <button style={{...S.bigBtn,flex:1,background:"#2a2a3a",border:"1px solid #3a3a5a",padding:"14px 8px"}} onClick={()=>TTS.stop()}>⏹</button>
                </div>
              )}
              <p style={{fontSize:12,color:"#666",textAlign:"center"}}>Talk it out — timer ends automatically</p>
            </div>
          );

          // ── ACCUSE ────────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.ACCUSE) {
            const iAmQuestioner = myRole==="questioner";
            return (
              <div style={S.card}>
                <h2 style={S.cardTitle}>🔍 Who's the Odd One Out?</h2>
                {iAmQuestioner ? (
                  <>
                    <p style={S.hint}>You're the Questioner — pick your suspect!</p>
                    {onlinePlayers.filter(p=>p.id!==myId).map(p=>(
                      <div key={p.id} style={{...S.suspectRow,border:onlineVoteTarget===p.id?`2px solid ${p.color}`:"2px solid #2a2a3a",background:onlineVoteTarget===p.id?"#1e1e2e":"#16161e"}}
                        onClick={()=>setOnlineVoteTarget(p.id)}>
                        <span style={{...S.dot,background:p.color,width:18,height:18}}/>
                        <span style={{fontWeight:600,color:"#e0e0e0"}}>{p.name}</span>
                        {onlineVoteTarget===p.id&&<span style={{marginLeft:"auto",color:p.color}}>◀</span>}
                      </div>
                    ))}
                    <button style={{...S.bigBtn,background:"#E05C5C",opacity:!onlineVoteTarget?0.4:1,marginTop:8}} disabled={!onlineVoteTarget}
                      onClick={()=>{ SFX.confirm(); sendToServer("accuse",{accusedId:onlineVoteTarget}); }}>
                      Accuse {onlinePlayers.find(p=>p.id===onlineVoteTarget)?.name||"…"}
                    </button>
                  </>
                ) : (
                  <div style={S.handoffCard}>
                    <div style={{fontSize:56}}>⏳</div>
                    <h2 style={S.handoffTitle}>Waiting…</h2>
                    <p style={S.handoffHint}>The Questioner is making their accusation.</p>
                  </div>
                )}
              </div>
            );
          }

          // ── VOTING ────────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.VOTING) return (
            <div style={S.card}>
              <h2 style={S.cardTitle}>🗳️ Cast Your Vote</h2>
              {myVoteCast ? (
                <div style={S.handoffCard}>
                  <div style={{fontSize:56}}>✅</div>
                  <h2 style={S.handoffTitle}>Vote cast!</h2>
                  <p style={S.handoffHint}>Waiting for others… {votedCount}/{onlinePlayers.length} voted</p>
                </div>
              ) : (
                <>
                  <p style={S.hint}>Who do you think got a different question?</p>
                  {onlinePlayers.filter(p=>p.id!==myId).map(p=>(
                    <div key={p.id} style={{...S.suspectRow,border:`2px solid ${p.color}44`,background:"#16161e"}}
                      onClick={()=>{ SFX.vote(); HX.tap(); setOnlineVoteTarget(p.id); setMyVoteCast(true); sendToServer("cast_vote",{targetId:p.id}); }}>
                      <span style={{...S.dot,background:p.color,width:18,height:18}}/>
                      <span style={{fontWeight:600,color:"#e0e0e0",fontSize:16}}>{p.name}</span>
                      <span style={{marginLeft:"auto",color:p.color,fontSize:20}}>→</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          );

          // ── REVEAL ────────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.REVEAL && revealData) {
            const imp = onlinePlayers.find(p=>p.id===revealData.imposterId);
            const accused = onlinePlayers.find(p=>p.id===revealData.accusedId);
            const correct = revealData.accusedId===revealData.imposterId;
            return (
              <div style={S.card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <h2 style={{...S.cardTitle,margin:0}}>📋 Round {onlineRound} Over</h2>
                  <span style={S.roundBadge}>{onlineRound}/{onlineTotalRounds}</span>
                </div>
                {correct
                  ? <div style={S.resultBanner("#5CCE8A")}>✅ Caught! <strong>{imp?.name}</strong> was the Odd One Out!</div>
                  : <div style={S.resultBanner("#E05C5C")}>👻 <strong>{imp?.name}</strong> fooled everyone and earns 3 pts!</div>
                }
                {revealData.mode==="vote" && revealData.voteTally && Object.keys(revealData.voteTally).length>0 && (
                  <div style={{marginBottom:12}}>
                    <h3 style={S.sectionTitle}>Vote breakdown</h3>
                    {onlinePlayers.map(p=>{
                      const count=revealData.voteTally[p.id]||0; if(!count) return null;
                      return (<div key={p.id} style={S.scoreRow}><span style={{color:p.color,fontWeight:700}}>{p.name}</span><span style={S.scoreNum}>{count} vote{count!==1?"s":""}</span></div>);
                    })}
                  </div>
                )}
                <div style={S.revealGrid}>
                  <div style={S.revealItem}><span style={S.revealLabel}>Real question</span><span style={S.revealValue}>"{revealData.pair?.real}"</span></div>
                  <div style={S.revealItem}><span style={S.revealLabel}>Odd One Out got</span><span style={{...S.revealValue,color:"#A05CE0"}}>"{revealData.pair?.imposter}"</span></div>
                </div>
                <h3 style={S.sectionTitle}>Answers</h3>
                {Object.entries(revealData.answers||{}).map(([pid,ans])=>{
                  const p=onlinePlayers.find(x=>x.id===pid);
                  const isImp=pid===revealData.imposterId;
                  if(!p) return null;
                  return (<div key={pid} style={{...S.answerCard,borderColor:isImp?"#A05CE0":"#2a2a3a",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><span style={{color:p.color,fontWeight:700}}>{p.name}</span>{isImp&&<span style={S.impBadge}>👻</span>}</div>
                    <div style={S.answerText}>"{ans}"</div>
                  </div>);
                })}
                <h3 style={S.sectionTitle}>Scores</h3>
                {[...onlinePlayers].sort((a,b)=>b.score-a.score).map((p,i)=>(
                  <div key={i} style={S.scoreRow}><span style={{color:p.color,fontWeight:700}}>{p.name}</span><span style={S.scoreNum}>{p.score} pts</span></div>
                ))}
                {isHost && (
                  <button style={{...S.bigBtn,marginTop:12}} onClick={()=>sendToServer("next_round")}>
                    {onlineRound>=onlineTotalRounds?"See Final Scores 🏆":"Next Round →"}
                  </button>
                )}
                {!isHost && <p style={{textAlign:"center",color:"#555",fontSize:13,marginTop:12}}>⏳ Waiting for host…</p>}
              </div>
            );
          }

          // ── SCOREBOARD ────────────────────────────────────────────────────
          if (onlinePhase===ONLINE_PHASES.SCOREBOARD) return (
            <div style={S.card}>
              <h2 style={S.cardTitle}>🏆 Final Scores</h2>
              {[...onlinePlayers].sort((a,b)=>b.score-a.score).map((p,i)=>(
                <div key={i} style={S.finalScoreRow}>
                  <span style={S.rank}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`}</span>
                  <span style={{color:p.color,fontWeight:700,fontSize:18}}>{p.name}</span>
                  <span style={S.scoreNum}>{p.score} pts</span>
                </div>
              ))}
              {isHost ? (
                <div style={{display:"flex",gap:8,marginTop:20}}>
                  <button style={{...S.bigBtn,flex:1}} onClick={()=>sendToServer("return_to_lobby")}>Play Again</button>
                </div>
              ) : <p style={{textAlign:"center",color:"#555",fontSize:13,marginTop:16}}>⏳ Waiting for host…</p>}
            </div>
          );

          return null;
        })()}

      </main>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root:{minHeight:"100vh",background:"#0e0e16",color:"#e0e0e0",fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column"},
  header:{background:"#13131f",borderBottom:"1px solid #2a2a3a",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"},
  logo:{fontSize:16,fontWeight:700},
  roundBadge:{background:"#2a2a3a",borderRadius:20,padding:"4px 14px",fontSize:13,color:"#aaa",fontWeight:600},
  main:{flex:1,padding:"16px",maxWidth:480,margin:"0 auto",width:"100%"},
  card:{background:"#13131f",borderRadius:16,padding:20,border:"1px solid #2a2a3a",marginBottom:16},
  cardTitle:{margin:"0 0 8px 0",fontSize:20,fontWeight:700},
  hint:{fontSize:13,color:"#888",marginBottom:14,lineHeight:1.6},
  warn:{fontSize:13,color:"#E05C5C",marginBottom:8},
  row:{display:"flex",gap:8,marginBottom:12},
  input:{flex:1,background:"#1e1e2e",border:"1px solid #2a2a3a",borderRadius:10,padding:"10px 14px",color:"#e0e0e0",fontSize:15,outline:"none"},
  btn:{background:"#5C9FE0",color:"#fff",border:"none",borderRadius:10,padding:"10px 16px",fontWeight:700,cursor:"pointer",fontSize:14,whiteSpace:"nowrap"},
  bigBtn:{width:"100%",background:"#5C9FE0",color:"#fff",border:"none",borderRadius:12,padding:"14px",fontWeight:700,fontSize:16,cursor:"pointer"},
  divider:{border:"none",borderTop:"1px solid #2a2a3a",margin:"16px 0"},
  settingsTitle:{fontSize:15,fontWeight:700,margin:"0 0 12px 0",color:"#ccc"},
  label:{display:"block",fontSize:13,color:"#888",marginBottom:6},
  sliderRow:{display:"flex",alignItems:"center",gap:10,marginBottom:16},
  slider:{flex:1,accentColor:"#5C9FE0"},
  sliderEnd:{fontSize:12,color:"#555",minWidth:16,textAlign:"center"},
  timerChip:{background:"#1e1e2e",border:"1px solid #2a2a3a",borderRadius:20,padding:"6px 14px",color:"#aaa",fontSize:13,cursor:"pointer",fontWeight:500},
  timerChipActive:{background:"#5C9FE022",border:"1px solid #5C9FE0",color:"#5C9FE0",fontWeight:700},
  playerList:{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12},
  playerChip:{borderRadius:20,padding:"6px 14px",fontWeight:700,fontSize:14,color:"#fff",display:"flex",alignItems:"center",gap:8},
  chipX:{cursor:"pointer",opacity:0.7,fontWeight:400,fontSize:12},
  modeCard:{flex:1,borderRadius:14,padding:"14px 10px",border:"2px solid #2a2a3a",cursor:"pointer",textAlign:"center",transition:"all 0.15s"},
  backBtn:{background:"none",border:"1px solid #3a3a5a",borderRadius:8,color:"#aaa",fontSize:18,padding:"2px 10px",cursor:"pointer",lineHeight:1.4},
  menuContainer:{display:"flex",flexDirection:"column",gap:12,paddingTop:8},
  menuHero:{textAlign:"center",padding:"28px 0 16px"},
  menuTitle:{margin:0,fontSize:32,fontWeight:800,letterSpacing:"-0.5px",color:"#e0e0e0"},
  menuSub:{margin:"6px 0 0",fontSize:14,color:"#555"},
  menuBtn:{display:"flex",alignItems:"center",gap:16,padding:"18px 20px",borderRadius:16,border:"none",cursor:"pointer",color:"#fff",textAlign:"left",width:"100%"},
  menuBtnTitle:{fontSize:17,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:8},
  menuBtnSub:{fontSize:12,opacity:0.75},
  comingSoon:{background:"#ffffff22",borderRadius:6,padding:"1px 7px",fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"},
  handoffCard:{background:"#0a0a12",borderRadius:20,padding:"40px 24px",border:"2px dashed #2a2a3a",marginBottom:16,display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",minHeight:340,justifyContent:"center"},
  handoffTitle:{fontSize:24,fontWeight:700,color:"#e0e0e0",margin:"0 0 10px 0"},
  handoffHint:{fontSize:15,color:"#777",lineHeight:1.6,margin:"0 0 16px 0",whiteSpace:"pre-line"},
  passNotice:{textAlign:"center",fontSize:16,marginBottom:16,color:"#aaa"},
  secretBox:{background:"#1e1e2e",borderRadius:14,padding:16,marginBottom:16},
  secretLabel:{fontSize:11,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:8},
  secretText:{fontSize:14,color:"#bbb",lineHeight:1.6,margin:"10px 0"},
  roleBadge:(color)=>({display:"inline-block",background:color+"22",color,border:`1px solid ${color}44`,borderRadius:8,padding:"4px 12px",fontWeight:700,fontSize:13,marginBottom:8}),
  topicBox:{background:"#13131f",borderRadius:10,padding:12,marginTop:10,borderLeft:"3px solid #5C9FE0"},
  topicLabel:{display:"block",fontSize:11,color:"#666",marginBottom:4,textTransform:"uppercase"},
  topicText:{fontSize:15,color:"#e0e0e0",fontStyle:"italic"},
  dot:{width:12,height:12,borderRadius:"50%",display:"inline-block",flexShrink:0},
  answersGrid:{display:"flex",flexDirection:"column",gap:8,marginBottom:14},
  answerCard:{background:"#1e1e2e",borderRadius:12,padding:12,border:"1px solid #2a2a3a"},
  answerName:{fontWeight:700,fontSize:13,marginBottom:4},
  answerText:{fontSize:15,color:"#ccc",fontStyle:"italic"},
  questionReminder:{background:"#1a1a2e",border:"1px solid #3a3a5a",borderLeft:"3px solid #E0C15C",borderRadius:10,padding:"10px 14px",marginBottom:12},
  questionReminderLabel:{display:"block",fontSize:11,color:"#E0C15C",textTransform:"uppercase",letterSpacing:1,marginBottom:4},
  questionReminderText:{fontSize:15,color:"#e0e0e0",fontStyle:"italic"},
  suspectRow:{display:"flex",alignItems:"center",gap:10,borderRadius:12,padding:"12px 14px",marginBottom:8,cursor:"pointer"},
  resultBanner:(color)=>({background:color+"22",border:`1px solid ${color}55`,borderRadius:12,padding:14,color,fontWeight:600,lineHeight:1.6,margin:"12px 0 16px"}),
  revealGrid:{display:"flex",flexDirection:"column",gap:8,marginBottom:16},
  revealItem:{background:"#1e1e2e",borderRadius:10,padding:12},
  revealLabel:{display:"block",fontSize:11,color:"#666",marginBottom:4,textTransform:"uppercase"},
  revealValue:{fontSize:14,color:"#ddd",fontStyle:"italic"},
  impBadge:{background:"#A05CE022",color:"#A05CE0",border:"1px solid #A05CE044",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700},
  sectionTitle:{fontSize:13,color:"#666",textTransform:"uppercase",letterSpacing:1,margin:"16px 0 8px"},
  scoreRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #1e1e2e"},
  scoreNum:{color:"#5C9FE0",fontWeight:700,fontSize:16},
  finalScoreRow:{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:"1px solid #1e1e2e"},
  rank:{fontSize:22,width:32},
  editorForm:{background:"#1a1a2e",borderRadius:12,padding:14,marginBottom:14,border:"1px solid #2a2a3a"},
  questionCard:{background:"#1a1a2e",borderRadius:10,padding:12,border:"1px solid #2a2a3a",marginBottom:8},
  toggleRow:{display:"flex",alignItems:"center",gap:10,padding:"10px 0",cursor:"pointer",marginBottom:4},
};
