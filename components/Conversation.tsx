import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { MicIcon } from './icons/MicIcon';
import { StopIcon } from './icons/StopIcon';
import Visualizer from './Visualizer';
import { TranscriptTurn } from '../types';

// --- Audio Encoding & Decoding functions ---
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const Conversation: React.FC = () => {
    const [isConnecting, setIsConnecting] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptTurn[]>([]);
    const [micVolume, setMicVolume] = useState(0);
    
    // --- Refs for managing session and audio contexts ---
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const playAudio = useCallback((base64Audio: string): Promise<void> => {
        return new Promise(async (resolve, reject) => {
            const outputAudioContext = outputAudioContextRef.current;
            if (!outputAudioContext) {
                console.warn("Audio context not available for playback.");
                return resolve();
            }

            setIsSpeaking(true);
            
            try {
                const nextStartTime = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.destination);
                
                source.onended = () => {
                    audioSourcesRef.current.delete(source);
                    if (audioSourcesRef.current.size === 0) {
                        setIsSpeaking(false);
                    }
                    resolve();
                };
                
                source.start(nextStartTime);
                nextStartTimeRef.current = nextStartTime + audioBuffer.duration;
                audioSourcesRef.current.add(source);
            } catch (error) {
                console.error("Error decoding or playing audio:", error);
                setIsSpeaking(false);
                reject(error);
            }
        });
    }, []);

    const cleanup = useCallback(() => {
        if (animationFrameIdRef.current) {
            cancelAnimationFrame(animationFrameIdRef.current);
            animationFrameIdRef.current = null;
        }

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.onaudioprocess = null;
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }

        analyserRef.current?.disconnect();
        analyserRef.current = null;
        sourceNodeRef.current?.disconnect();
        sourceNodeRef.current = null;

        inputAudioContextRef.current?.close().catch(console.error);
        inputAudioContextRef.current = null;
        
        outputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current = null;

        for (const source of audioSourcesRef.current.values()) {
            source.stop();
        }
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;

        setIsConnected(false);
        setIsConnecting(false);
        setIsSpeaking(false);
        setMicVolume(0);
    }, []);

    const handleStop = useCallback(async () => {
        if (!sessionPromiseRef.current) return;
        
        const session = await sessionPromiseRef.current;
        session.close();
        sessionPromiseRef.current = null;
        cleanup();
    }, [cleanup]);

    const handleStart = useCallback(async () => {
        setIsConnecting(true);
        setTranscriptionHistory([]);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: async () => {
                        setIsConnecting(false);
                        setIsConnected(true);
                        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

                        sourceNodeRef.current = inputAudioContextRef.current.createMediaStreamSource(stream);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        const sendAudioChunk = (inputData: Float32Array) => {
                             const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) {
                                int16[i] = inputData[i] * 32768;
                            }
                            const pcmBlob = {
                                data: encode(new Uint8Array(int16.buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            if (sessionPromiseRef.current) {
                                sessionPromiseRef.current.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            }
                        }

                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            sendAudioChunk(inputData);
                        };
                        
                        analyserRef.current = inputAudioContextRef.current.createAnalyser();
                        analyserRef.current.fftSize = 256;

                        sourceNodeRef.current.connect(analyserRef.current);
                        sourceNodeRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);

                        const visualize = () => {
                            if (!analyserRef.current) return;
                            const bufferLength = analyserRef.current.frequencyBinCount;
                            const dataArray = new Uint8Array(bufferLength);
                            analyserRef.current.getByteFrequencyData(dataArray);

                            let sum = 0;
                            for (let i = 0; i < bufferLength; i++) {
                                sum += dataArray[i];
                            }
                            const average = sum / bufferLength;
                            const normalizedVolume = Math.min(1, average / 128);
                            setMicVolume(normalizedVolume);

                            animationFrameIdRef.current = requestAnimationFrame(visualize);
                        };
                        visualize();
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio) {
                            await playAudio(base64Audio);
                        }

                        if (message.serverContent?.interrupted) {
                            for (const source of audioSourcesRef.current.values()) {
                                source.stop();
                            }
                            audioSourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                            setIsSpeaking(false);
                        }

                        if (message.serverContent?.inputTranscription) {
                            const { text } = message.serverContent.inputTranscription;
                            setTranscriptionHistory(prev => {
                                const last = prev[prev.length - 1];
                                if (last?.speaker === 'user' && !last.isFinal) {
                                    const updated = [...prev];
                                    updated[prev.length - 1] = { ...last, text: last.text + text, isFinal: false };
                                    return updated;
                                }
                                return [...prev, { speaker: 'user', text, isFinal: false }];
                            });
                        }

                        if (message.serverContent?.outputTranscription) {
                            const { text } = message.serverContent.outputTranscription;
                             setTranscriptionHistory(prev => {
                                const last = prev[prev.length - 1];
                                if (last?.speaker === 'ai' && !last.isFinal) {
                                    const updated = [...prev];
                                    updated[prev.length - 1] = { ...last, text: last.text + text, isFinal: false };
                                    return updated;
                                }
                                return [...prev, { speaker: 'ai', text, isFinal: false }];
                            });
                        }

                        if (message.serverContent?.turnComplete) {
                            setTranscriptionHistory(prev => {
                                return prev.map(turn => turn.isFinal ? turn : { ...turn, isFinal: true });
                            });
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('API Error:', e);
                        handleStop();
                    },
                    onclose: (e: CloseEvent) => {
                        cleanup();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    systemInstruction: "You are a friendly and empathetic voice AI agent. Your primary role is to be a good listener. Encourage users to share their stories and thoughts. Respond thoughtfully, but avoid interrupting them unless necessary. Let the user guide the conversation. Ignore any background noise or non-verbal sounds.",
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
            });
        } catch (error) {
            console.error('Error starting conversation:', error);
            setIsConnecting(false);
            alert("Could not start conversation. Please allow microphone access and try again.");
        }
    }, [cleanup, handleStop, playAudio]);
    
    useEffect(() => {
        return () => {
            if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(s => s.close());
            }
            cleanup();
        };
    }, [cleanup]);

    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [transcriptionHistory]);


    return (
        <div className="w-full max-w-4xl h-[80vh] flex flex-col items-center justify-between">
            <h1 className="text-4xl md:text-5xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-cyan-400 dark:from-blue-400 dark:to-cyan-300 mb-4">
                Gemini Voice Agent
            </h1>
            <div ref={scrollContainerRef} className="flex-grow w-full bg-white/50 dark:bg-black/50 backdrop-blur-sm rounded-xl shadow-lg p-4 overflow-y-auto mb-6 no-scrollbar">
                {transcriptionHistory.length === 0 && !isConnected && !isConnecting && (
                    <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                        <p>Press the microphone to start the conversation.</p>
                    </div>
                )}
                 {transcriptionHistory.map((turn, index) => (
                    <div key={index} className={`w-full flex mb-3 ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`p-3 rounded-lg max-w-[70%] w-fit ${turn.speaker === 'user' ? 'bg-blue-100 dark:bg-blue-900/50' : 'bg-slate-200 dark:bg-slate-800/50'}`}>
                            <p className={`text-sm break-words ${!turn.isFinal ? 'text-slate-500' : ''}`}>{turn.text}</p>
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-col items-center">
                <Visualizer isSpeaking={isSpeaking} isConnected={isConnected} micVolume={micVolume} />
                <button
                    onClick={isConnected ? handleStop : handleStart}
                    disabled={isConnecting}
                    className="mt-6 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-wait
                        bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 shadow-lg hover:shadow-xl transform hover:scale-105"
                    aria-label={isConnected ? "Stop conversation" : "Start conversation"}
                >
                    {isConnecting ? (
                       <div className="w-8 h-8 border-4 border-t-transparent border-white rounded-full animate-spin"></div>
                    ) : isConnected ? (
                        <StopIcon className="w-8 h-8" />
                    ) : (
                        <MicIcon className="w-8 h-8" />
                    )}
                </button>
            </div>
        </div>
    );
};

export default Conversation;