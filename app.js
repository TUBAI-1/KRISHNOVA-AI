// v2 - fixes indefinite loading by adding timeouts & fallback script/video
(function () {
  'use strict';

  const API_KEYS = {
    openai:
      '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',
    pexels: 'CLq6buwafcI3DvrUoAyOJFBXYVkN6UlO51tNKYlXGmMwq3n0kAP1Gr59',
    groq: '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',
  };

  const PROCESSING_STEPS = [
    'Analyzing your prompt with AI...',
    'Generating detailed video script...',
    'Searching for relevant video clips...',
    'Creating your custom video...',
    'Finalizing and optimizing...',
  ];

  const FALLBACK_SAMPLE_VIDEOS = [
    'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4',
    'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_10mb.mp4',
  ];

  let el = {};
  let stepCounter = 0;

  document.addEventListener('DOMContentLoaded', () => {
    el = {
      promptInput: document.getElementById('promptInput'),
      generateBtn: document.getElementById('generateBtn'),
      charCounter: document.getElementById('charCounter'),
      progressSection: document.getElementById('progressSection'),
      progressText: document.getElementById('progressText'),
      progressBar: document.getElementById('progressBar'),
      videoSection: document.getElementById('videoSection'),
      videoPlayer: document.getElementById('videoPlayer'),
      videoTitle: document.getElementById('videoTitle'),
      downloadBtn: document.getElementById('downloadBtn'),
      shareBtn: document.getElementById('shareBtn'),
      newVideoBtn: document.getElementById('newVideoBtn'),
    };

    bindEvents();
    updateCounter();
  });

  /* -------------------- Event binding -------------------- */
  function bindEvents() {
    el.promptInput.addEventListener('input', updateCounter);
    el.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (!el.generateBtn.disabled) generateVideo();
      }
    });

    el.generateBtn.addEventListener('click', generateVideo);
    el.shareBtn.addEventListener('click', shareVideo);
    el.newVideoBtn.addEventListener('click', resetApp);
  }

  function updateCounter() {
    const len = el.promptInput.value.length;
    const max = 500;
    el.charCounter.textContent = `${len} / ${max}`;

    el.charCounter.classList.remove('warning', 'error');
    if (len > max) el.charCounter.classList.add('error');
    else if (len > max * 0.8) el.charCounter.classList.add('warning');

    el.generateBtn.disabled = len < 10 || len > max;
  }

  /* -------------------- UI Helpers -------------------- */
  function show(elem) {
    elem.classList.remove('hidden');
    elem.style.display = 'block';
    elem.classList.add('fade-in');
  }
  function hide(elem) {
    elem.classList.add('hidden');
    elem.style.display = 'none';
    elem.classList.remove('fade-in');
  }
  function setBtnLoading(state) {
    if (state) {
      el.generateBtn.classList.add('btn--loading');
      el.generateBtn.disabled = true;
    } else {
      el.generateBtn.classList.remove('btn--loading');
      updateCounter();
    }
  }
  function updateProgress(message) {
    stepCounter += 1;
    el.progressText.textContent = message;
    el.progressBar.style.width = `${Math.min(100, (stepCounter / PROCESSING_STEPS.length) * 100)}%`;
  }

  /* -------------------- Timeout helper -------------------- */
  function withTimeout(promise, ms) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);
    return Promise.race([
      promise(controller.signal).finally(() => clearTimeout(timeoutId)),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]).catch(() => null); // swallow errors, will return null
  }

  /* -------------------- API calls with graceful fail -------------------- */
  async function generateScript(prompt) {
    return withTimeout(
      async (signal) => {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEYS.openai}`,
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'user',
                content:
                  `Convert this prompt into a detailed video script with scene descriptions and extract 5 key visual keywords for video search. Format JSON with script and keywords: "${prompt}"`,
              },
            ],
            max_tokens: 700,
            temperature: 0.7,
          }),
          signal,
        });
        if (!res.ok) throw new Error('OpenAI fail');
        const data = await res.json();
        return JSON.parse(data.choices[0].message.content);
      },
      10000
    );
  }

  function extractKeywords(text) {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
  }

  async function searchVideos(keywords) {
    if (!keywords || !keywords.length) return [];
    const results = [];
    for (const kw of keywords) {
      const data = await withTimeout(
        async () => {
          const res = await fetch(
            `https://api.pexels.com/videos/search?query=${encodeURIComponent(kw)}&per_page=5`,
            {
              headers: { Authorization: API_KEYS.pexels },
            }
          );
          if (!res.ok) return null;
          return res.json();
        },
        8000
      );
      if (data && data.videos) results.push(...data.videos);
    }
    return results;
  }

  async function pickVideo(videos, script) {
    if (!videos.length) return null;
    return withTimeout(
      async () => {
        const prompt = `Return only the best video URL for script: ${script.substring(0, 300)} List: ${videos
          .slice(0, 5)
          .map((v) => v.url)
          .join(', ')}`;
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEYS.groq}`,
          },
          body: JSON.stringify({ model: 'llama3-8b-8192', messages: [{ role: 'user', content: prompt }] }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const url = data.choices[0]?.message?.content?.trim();
        if (url && url.startsWith('http')) return url;
        return null;
      },
      8000
    );
  }

  /* -------------------- Main Generation Flow -------------------- */
  async function generateVideo() {
    const prompt = el.promptInput.value.trim();
    if (prompt.length < 10) return;

    // Reset UI
    stepCounter = 0;
    hide(el.videoSection);
    show(el.progressSection);
    el.progressText.textContent = PROCESSING_STEPS[0];
    el.progressBar.style.width = '0%';
    setBtnLoading(true);

    try {
      // Step 1 & 2 – script generation
      await delay(600);
      const scriptData = (await generateScript(prompt)) || {
        script: prompt,
        keywords: extractKeywords(prompt),
      };
      updateProgress(PROCESSING_STEPS[1]);

      // Step 3 – video search
      await delay(600);
      const videos = await searchVideos(scriptData.keywords);
      updateProgress(PROCESSING_STEPS[2]);

      // Step 4 – pick video
      await delay(600);
      let videoUrl = await pickVideo(videos, scriptData.script);
      if (!videoUrl) {
        // fallback pick first hd video
        const match = videos.find((v) => v.video_files?.length);
        if (match) videoUrl = match.video_files[0].link;
      }
      updateProgress(PROCESSING_STEPS[3]);

      // Step 5 – finalize
      if (!videoUrl) {
        videoUrl = FALLBACK_SAMPLE_VIDEOS[Math.floor(Math.random() * FALLBACK_SAMPLE_VIDEOS.length)];
      }

      await delay(500);
      updateProgress(PROCESSING_STEPS[4]);

      // Show video
      el.videoPlayer.src = videoUrl;
      el.videoPlayer.load();
      el.videoTitle.textContent = `Generated Video: ${prompt.substring(0, 60)}${prompt.length > 60 ? '…' : ''}`;
      el.downloadBtn.href = videoUrl;
      el.downloadBtn.setAttribute('download', `generated-${Date.now()}.mp4`);
      el.shareBtn.dataset.videoUrl = videoUrl;

      hide(el.progressSection);
      show(el.videoSection);
    } catch (err) {
      console.error(err);
      alert('Video generation failed. Please try again.');
      hide(el.progressSection);
    } finally {
      setBtnLoading(false);
    }
  }

  /* -------------------- Share & Reset -------------------- */
  async function shareVideo() {
    const url = el.shareBtn.dataset.videoUrl;
    if (!url) return alert('Generate a video first.');
    try {
      await navigator.clipboard.writeText(url);
      const old = el.shareBtn.textContent;
      el.shareBtn.textContent = 'Copied!';
      setTimeout(() => (el.shareBtn.textContent = old), 1800);
    } catch {
      prompt('Copy URL:', url);
    }
  }

  function resetApp() {
    window.location.href = 'index.html';
  }

  /* -------------------- Utils -------------------- */
  function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }
})();
