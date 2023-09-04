/* global chrome */
const SVG_MIC_HTML = '<svg stroke="currentColor" fill="none" ... > ... </svg>';
const SVG_MIC_SPINNING_HTML = '<svg stroke="currentColor" fill="none" ... > ... </svg>';
const SVG_SPINNER_HTML = '<div style="position:relative;width:24px;height:16px;"> ... </div>';
const TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TRANSLATION_URL = 'https://api.openai.com/v1/audio/translations';
const MICROPHONE_BUTTON_CLASSES = 'absolute p-1 rounded-md text-gray-500 bottom-1.5 right-1 md:bottom-2.5 md:right-2 hover:bg-gray-100 dark:hover:text-gray-400 dark:hover:bg-gray-900';

const TESTING = false;

async function retrieveFromStorage(key) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(key, function (result) {
            resolve(result[key]);
        });
    });
}

class AudioRecorder {
    constructor() {
        this.recording = false;
        this.mediaRecorder = null;
        this.textarea = null;
        this.micButton = null;
        this.token = null;
        this.snippetButtons = [];
    }

    async listenForKeyboardShortcut() {
        if (await this.shortcutEnabled()) {
            const shortcutFirstKey = await retrieveFromStorage('config_shortcut_first_key');
            const shortcutFirstModifier = await retrieveFromStorage('config_shortcut_first_modifier');
            const shortcutSecondModifier = await retrieveFromStorage('config_shortcut_second_modifier');
            
            document.addEventListener('keydown', (event) => {
                if (event.code === `Key${shortcutFirstKey.toUpperCase()}`) {
                    if (shortcutFirstModifier && shortcutFirstModifier !== 'none' && !event[shortcutFirstModifier]) return;
                    if (shortcutSecondModifier && shortcutSecondModifier !== 'none' && !event[shortcutSecondModifier]) return;

                    event.preventDefault();

                    const textarea = document.querySelector('textarea[data-id]');
                    if (textarea) {
                        const micButton = textarea.parentNode.querySelector('.microphone_button');
                        if (micButton) {
                            micButton.click();
                        }
                    }
                }
            });
        }
    }

    createMicButton(inputType) {
        this.micButton = document.createElement('button');
        this.micButton.className = `microphone_button ${MICROPHONE_BUTTON_CLASSES}`;
        this.micButton.style.marginRight = inputType === 'main' ? '2.2rem' : '26.5rem';
        this.micButton.innerHTML = SVG_MIC_HTML;
        this.micButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleRecording();
        });
    }

    async createSnippetButtons() {
        const snippets = await retrieveFromStorage('snippets');
        if (!snippets) return;

        const numberOfRows = Math.ceil(snippets.length / 9);
        snippets.forEach((snippet, index) => {
            if (!snippet) return;
            const button = document.createElement('button');
            button.textContent = index + 1;
            button.className = `snippet_button ${MICROPHONE_BUTTON_CLASSES}`;

            const y = -0.6 - numberOfRows * 2.2 + Math.floor(index / 9) * 2.2;
            const x = -45.7 + (index % 9) * 2;
            button.style.transform = `translate(${x}rem, ${y}rem)`;

            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.insertTextResult(snippet);
            });
            this.textarea.parentNode.insertBefore(button, this.textarea.nextSibling);
            this.snippetButtons.push({ button, x, y, initialY: y });
        });
    }

    updateButtonGridPosition() {
        const textareaRows = this.textarea.clientHeight / 24;

        if (this.snippetButtons) {
            this.snippetButtons.forEach((buttonObj, index) => {
                buttonObj.y = buttonObj.initialY - (textareaRows - 1) * 1.5;
                buttonObj.button.style.transform = `translate(${buttonObj.x}rem, ${buttonObj.y}rem)`;
            });
        }
    }

    observeTextareaResize() {
        this.resizeObserver = new ResizeObserver(() => {
            this.updateButtonGridPosition();
        });
        this.resizeObserver.observe(this.textarea);
    }

    async downloadEnabled() {
        const downloadEnabled = await retrieveFromStorage('config_enable_download');
        return downloadEnabled;
    }

    async translationEnabled() {
        const translationEnabled = await retrieveFromStorage('config_enable_translation');
        return translationEnabled;
    }

    async snippetsEnabled() {
        const snippetsEnabled = await retrieveFromStorage('config_enable_snippets');
        return snippetsEnabled;
    }

    async shortcutEnabled() {
        const shortcutEnabled = await retrieveFromStorage('config_enable_shortcut');
        return shortcutEnabled;
    }

    async retrieveToken() {
        return await retrieveFromStorage('openai_token');
    }

    async getSelectedPrompt() {
        const selectedPrompt = await retrieveFromStorage('openai_selected_prompt');
        const prompts = await retrieveFromStorage('openai_prompts');
        if (!prompts || !selectedPrompt) {
            const initialPrompt = {
                title: 'Initial prompt',
                content: 'The transcript is about OpenAI ...',
            };
            await chrome.storage?.sync.set(
                {
                    openai_prompts: [initialPrompt],
                    openai_selected_prompt: 0,
                },
                () => {}
            );
            return initialPrompt;
        } else {
            return prompts[selectedPrompt];
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            let chunks = [];
            this.mediaRecorder.addEventListener('dataavailable', (event) => chunks.push(event.data));

            this.mediaRecorder.addEventListener('stop', async () => {
                this.setButtonState('loading');
                const audioBlob = new Blob(chunks, { type: 'audio/webm' });

                const file = audioBlob;

                if (await this.downloadEnabled()) {
                    downloadFile(file);
                }

                const storedToken = await this.retrieveToken();
                const storedPrompt = await this.getSelectedPrompt();

                const headers = new Headers({
                    Authorization: `Bearer ${storedToken}`,
                });
                const formData = new FormData();
                formData.append('file', file, 'recording.webm');
                formData.append('model', 'whisper-1');
                formData.append('prompt', storedPrompt.content);

                const requestOptions = {
                    method: 'POST',
                    headers,
                    body: formData,
                    redirect: 'follow',
                };

                const requestUrl = (await this.translationEnabled()) ? TRANSLATION_URL : TRANSCRIPTION_URL;

                const response = await fetch(requestUrl, requestOptions);
                this.setButtonState('ready');
                if (response.status === 200) {
                    const result = await response.json();
                    const resultText = result.text;
                    this.insertTextResult(resultText);
                    this.recording = false;
                    stream.getTracks().forEach((track) => track.stop());
                } else {
                    this.insertTextResult(
                        `${response.status} ERROR! API key not provided or OpenAI Server Error! Check the Pop-up window of the Extension to provide API key.`
                    );
                    this.recording = false;
                    stream.getTracks().forEach((track) => track.stop());
                }
            });
            this.mediaRecorder.start();
            this.setButtonState('recording');
            this.recording = true;
        } catch (error) {
            console.error(error);
        }
    }

    stopRecording() {
        this.mediaRecorder.stop();
        this.micButton.innerHTML = SVG_MIC_HTML;
        this.recording = false;
    }

    toggleRecording() {
        if (!this.recording) {
            this.startRecording();
        } else {
            this.stopRecording();
        }
    }

    insertTextResult(resultText) {
        const startPos = this.textarea.selectionStart;
        const endPos = this.textarea.selectionEnd;
        const newText = this.textarea.value.substring(0, startPos) + resultText + this.textarea.value.substring(endPos);
        this.textarea.value = newText;
        this.textarea.selectionStart = startPos + resultText.length;
        this.textarea.selectionEnd = this.textarea.selectionStart;
        this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    setButtonState(state) {
        const hoverClasses = ['hover:bg-gray-100', 'dark:hover:text-gray-400', 'dark:hover:bg-gray-900'];
        switch (state) {
            case 'recording':
                this.micButton.disabled = false;
                this.micButton.innerHTML = SVG_MIC_SPINNING_HTML;
                break;
            case 'loading':
                this.micButton.disabled = true;
                this.micButton.innerHTML = SVG_SPINNER_HTML;
                this.micButton.classList.remove(...hoverClasses);
                break;
            case 'ready':
            default:
                this.micButton.disabled = false;
                this.micButton.innerHTML = SVG_MIC_HTML;
                this.micButton.classList.add(...hoverClasses);
                break;
        }
    }
}

async function init() {
    if (TESTING) {
        chrome.storage.sync.clear();
    }

    const textInputs = document.querySelectorAll('textarea, input[type="text"]');

    textInputs.forEach(async (inputElem) => {
        const recorder = new AudioRecorder();
        await recorder.listenForKeyboardShortcut();
        if (!inputElem.parentNode.querySelector('.microphone_button')) {
            recorder.textarea = inputElem;
            recorder.createMicButton('main');
            inputElem.parentNode.insertBefore(recorder.micButton, inputElem.nextSibling);
            if (await recorder.snippetsEnabled()) {
                await recorder.createSnippetButtons();
                recorder.observeTextareaResize();
            }
        }
    });

    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    document.addEventListener('click', handleClick);
}

function downloadFile(file) {
    const fileName = `Recording ${new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    })}.webm`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
}

let previousPathname = '';
let timeout1Id = null;
let timeout2Id = null;
let timeout3Id = null;

function addMicButtonToTextareas() {
    const textInputs = document.querySelectorAll('textarea, input[type="text"]');
    textInputs.forEach((inputElem) => {
        if (!inputElem.parentNode.querySelector('.microphone_button')) {
            const recorder = new AudioRecorder();
            recorder.textarea = inputElem;
            recorder.createMicButton('main');
            inputElem.parentNode.insertBefore(recorder.micButton, inputElem.nextSibling);
        }
    });
}

function handleMutations(mutations) {
    mutations.forEach((mutation) => {
        if (previousPathname !== window.location.pathname) {
            previousPathname = window.location.pathname;

            addMicButtonToTextareas();
            if (timeout1Id) clearTimeout(timeout1Id);
            if (timeout2Id) clearTimeout(timeout2Id);
            if (timeout3Id) clearTimeout(timeout3Id);
            timeout1Id = setTimeout(() => {
                addMicButtonToTextareas();
            }, 333);
            timeout2Id = setTimeout(() => {
                addMicButtonToTextareas();
            }, 666);
            timeout3Id = setTimeout(() => {
                addMicButtonToTextareas();
            }, 1000);
        }
    });
}

async function handleClick(event) {
    const target = event.target;
    if ((target.nodeName === 'TEXTAREA' || target.nodeName === 'INPUT') && !target.parentNode.querySelector('.microphone_button')) {
        const recorder = new AudioRecorder();
        recorder.textarea = target;
        recorder.createMicButton('main');
        target.parentNode.insertBefore(recorder.micButton, target.nextSibling);
        if (await recorder.snippetsEnabled()) {
            await recorder.createSnippetButtons();
            recorder.observeTextareaResize();
        }
    }
}

init();
