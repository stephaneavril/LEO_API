import {
  AvatarQuality,
  StreamingEvents,
  VoiceChatTransport,
  VoiceEmotion,
  StartAvatarRequest,
  STTProvider,
  ElevenLabsModel,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";
import { useRouter } from "next/router"; // Import useRouter

import { Button } from "./Button";
import { AvatarConfig } from "./AvatarConfig";
import { AvatarVideo } from "./AvatarSession/AvatarVideo";
import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { AvatarControls } from "./AvatarSession/AvatarControls";
import { useVoiceChat } from "./logic/useVoiceChat";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { LoadingIcon } from "./Icons";
import { MessageHistory } from "./AvatarSession/MessageHistory"; // Assuming this component exists

// Define DEFAULT_CONFIG outside the component to prevent re-creation on re-renders
const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: "Ann_Doctor_Standing2_public",
  knowledgeId: "13f254b102cf436d8c07b9fb617dbadf",
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "es",
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

// Helper for browser check
const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined";

function InteractiveAvatar() {
  // HeyGen Streaming Avatar Session Hooks
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream, messageHistory: sessionMessageHistory } = // Assuming messageHistory is provided by useStreamingAvatarSession
    useStreamingAvatarSession();
  const { startVoiceChat, isVoiceChatActive } = useVoiceChat();

  // Component State
  const [config, setConfig] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const [showAutoplayBlockedMessage, setShowAutoplayBlockedMessage] = useState(false);
  const [isAttemptingAutoStart, setIsAttemptingAutoStart] = useState(false);

  // Video Recording State
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const [recordingTimer, setRecordingTimer] = useState<number>(600); // 600s = 10min

  // Refs for Video Elements
  const userCameraRef = useRef<HTMLVideoElement>(null);
  const mediaStream = useRef<HTMLVideoElement>(null); // Ref for HeyGen avatar video

  const router = useRouter(); // Initialize router

  // Function to stop recording, finalize data, and redirect
  // This needs to be a useCallback or useMemoizedFn to avoid re-creation issues
  const stopAndFinalizeSession = useMemoizedFn(async () => {
    console.log("🛑 Deteniendo grabación y sesión...");
    stopAvatar(); // Stop the HeyGen avatar session

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      // Wait for ondataavailable to fire one last time if it's still recording
      await new Promise(resolve => {
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.onstop = resolve;
        } else {
          resolve(null); // Resolve immediately if recorder is null
        }
      });

      const videoBlob = new Blob(recordedChunks.current, { type: "video/webm" });

      const formData = new FormData();
      formData.append("video", videoBlob, "user_recording.webm"); // Add filename for robustness
      // Use the messageHistory from useStreamingAvatarSession
      formData.append("transcript", JSON.stringify(sessionMessageHistory || []));

      try {
        console.log("Attempting to upload recording...");
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          console.log("✅ Grabación enviada con éxito.");
        } else {
          const errorText = await res.text();
          console.error("❌ Error al subir grabación:", res.status, errorText);
        }
      } catch (err) {
        console.error("❌ Error en la solicitud de subida:", err);
      }
    } else {
      console.log("No active media recorder found or already stopped.");
    }

    // Redirect after stopping everything
    router.push("/dashboard");
  });


  // Effect to access user camera for local preview
  useEffect(() => {
    if (!isBrowser || !navigator.mediaDevices?.getUserMedia) {
      console.warn("Browser does not support getUserMedia or is not a browser environment.");
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: false }) // Request video only for preview
      .then((stream) => {
        if (userCameraRef.current) {
          userCameraRef.current.srcObject = stream;
          console.log("🎥 User camera preview stream acquired.");
        }
      })
      .catch((error) => {
        console.error("❌ No se pudo acceder a la cámara del usuario para la vista previa:", error);
        // This specific error does not necessarily block the avatar, just the local preview.
        // The main mic check is done within startSessionV2 for voice chat initiation.
      });

    // Cleanup function for user camera stream when component unmounts or effect re-runs
    return () => {
        if (userCameraRef.current && userCameraRef.current.srcObject) {
            (userCameraRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
            userCameraRef.current.srcObject = null;
        }
    };
  }, []);

  // Function to fetch access token
  const fetchAccessToken = useCallback(async () => {
    try {
      console.log("Fetching access token...");
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch access token: ${response.status} ${errorText}`);
      }
      const token = await response.text();
      console.log("Access Token received.");
      return token;
    } catch (error) {
      console.error("Error fetching access token:", error);
      throw error;
    }
  }, []);

  // Function to start user camera recording
  const startUserCameraRecording = useCallback(() => {
    if (userCameraRef.current && userCameraRef.current.srcObject) {
      const stream = userCameraRef.current.srcObject as MediaStream;
      // Ensure there's at least one video track to record
      if (stream.getVideoTracks().length === 0) {
        console.warn("No video track available for recording from user camera.");
        return;
      }

      // If a recorder already exists and is active, stop it first to prevent multiple recordings
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
          console.log("🎥 Previous recording stopped before starting new one.");
      }

      try {
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp8' }); // Specify mimeType and codec for better compatibility
        recordedChunks.current = []; // Clear previous chunks

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) recordedChunks.current.push(event.data);
        };

        recorder.onerror = (event) => {
            console.error("MediaRecorder error:", event);
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        console.log("🎥 Grabación iniciada del usuario.");
      } catch (error) {
          console.error("Failed to start MediaRecorder:", error);
      }
    } else {
      console.warn("Cannot start recording: User camera stream not available.");
    }
  }, []);


  // Memoized function to start the avatar session
  const startSessionV2 = useMemoizedFn(async (startWithVoice: boolean) => {
    console.log(`startSessionV2 called. startWithVoice: ${startWithVoice}. Current sessionState: ${sessionState}`);
    setIsAttemptingAutoStart(true);
    setShowAutoplayBlockedMessage(false);

    try {
      // --- Step 1: Request Microphone Permission (if voice chat is desired) ---
      if (startWithVoice) {
        console.log("Attempting to request microphone permission...");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop()); // Stop tracks immediately after check
          console.log("Microphone permission granted.");
        } catch (permError: any) {
          console.error("Microphone permission denied or no mic found:", permError);
          setShowAutoplayBlockedMessage(true);
          throw new Error(`Microphone access denied or not available: ${permError.name || permError.message}`);
        }
      }

      // --- Step 2: Fetch Access Token and Initialize Avatar ---
      const newToken = await fetchAccessToken();
      const avatar = initAvatar(newToken);
      console.log("Avatar initialized with new token.");

      // --- Step 3: Set up Event Listeners for HeyGen Avatar ---
      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => console.log("Avatar started talking"));
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => console.log("Avatar stopped talking"));
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        setShowAutoplayBlockedMessage(false);
        setIsAttemptingAutoStart(false);
        // Important: If HeyGen stream disconnects, finalize session, including stopping user recording.
        stopAndFinalizeSession();
      });
      avatar.on(StreamingEvents.STREAM_READY, (event) => {
        console.log(">>>>> Stream ready:", event.detail);
        setShowAutoplayBlockedMessage(false);
        setIsAttemptingAutoStart(false);
        // Start user camera recording ONLY when HeyGen stream is ready
        startUserCameraRecording();
        setRecordingTimer(600); // Reset timer when session starts
      });
      avatar.on(StreamingEvents.USER_START, (event) => console.log(">>>>> User started talking:", event));
      avatar.on(StreamingEvents.USER_STOP, () => console.log(">>>>> User stopped talking."));
      avatar.on(StreamingEvents.USER_END_MESSAGE, (event) => console.log(">>>>> User end message:", event));
      avatar.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => console.log(">>>>> User talking message:", event));
      avatar.on(StreamingEvents.AVATAR_TALKING_MESSAGE, (event) => console.log(">>>>> Avatar talking message:", event));
      avatar.on(StreamingEvents.AVATAR_END_MESSAGE, (event) => console.log(">>>>> Avatar end message:", event));
      avatar.on(
        StreamingEvents.CONNECTION_QUALITY_CHANGED,
        ({ detail }) => {
          console.log("Connection quality changed:", detail);
        }
      );

      // --- Step 4: Start Avatar Video Stream ---
      console.log("Attempting to start Avatar video with config:", config);
      await startAvatar(config);

      // --- Step 5: Start Voice Chat (if enabled and permission granted) ---
      if (startWithVoice) {
        console.log("Attempting to start voice chat (after avatar video started)...");
        await startVoiceChat();
        console.log("Voice chat start call completed.");
      }

    } catch (error: any) {
      console.error("Error starting avatar session:", error);
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        console.log("Detected NotAllowedError (Autoplay/Permissions blocked, e.g., video or mic).");
        setShowAutoplayBlockedMessage(true);
      } else if (error.message && error.message.includes("Microphone access denied")) {
        console.log("Microphone access specifically denied. Showing autoplay blocked message.");
        setShowAutoplayBlockedMessage(true);
      } else {
        console.error("General error during session start:", error);
      }
      stopAvatar(); // Ensure cleanup on *any* error during setup
      // Do NOT call stopAndFinalizeSession here immediately as it will redirect
      // unless you explicitly want to redirect on any initial error.
    } finally {
      setIsAttemptingAutoStart(false);
    }
  });

  // Cleanup on component unmount
  useUnmount(() => {
    console.log("Component unmounting, stopping avatar and finalizing session.");
    stopAndFinalizeSession(); // Ensure recording is stopped and data is sent on unmount
  });

  // Effect to handle HeyGen avatar stream video playback (Autoplay handling)
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play()
          .then(() => {
            console.log("Stream Effect: HeyGen Video played successfully.");
            setShowAutoplayBlockedMessage(false);
          })
          .catch((error) => {
            console.warn("Stream Effect: Autoplay bloqueado (video playback failed):", error);
            setShowAutoplayBlockedMessage(true);
            stopAvatar(); // Stop HeyGen avatar if autoplay blocked
          });
      };
    }
  }, [mediaStream, stream, stopAvatar]);

  // Effect to re-attempt playback if avatar video is paused/stuck after connection
  useEffect(() => {
    if (sessionState === StreamingAvatarSessionState.CONNECTED && stream && mediaStream.current) {
      const videoElement = mediaStream.current;
      const checkAndPlay = setTimeout(() => {
        if (videoElement.paused || videoElement.ended || videoElement.readyState < 3) {
          console.log("El video del avatar no se está reproduciendo, intentando reproducir de nuevo...");
          videoElement.play().catch(e => console.error("Error al reproducir el video de nuevo:", e));
        }
      }, 1000);
      return () => clearTimeout(checkAndPlay);
    }
  }, [sessionState, stream]);

  // Auto-start session on load
  useEffect(() => {
    if (sessionState === StreamingAvatarSessionState.INACTIVE && !showAutoplayBlockedMessage && !isAttemptingAutoStart) {
      console.log("Auto-start Effect: Attempting to start session with voice chat.");
      startSessionV2(true);
    }
  }, [sessionState, startSessionV2, showAutoplayBlockedMessage, isAttemptingAutoStart]);

  // Effect for recording timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (sessionState === StreamingAvatarSessionState.CONNECTED) {
      interval = setInterval(() => {
        setRecordingTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            console.log("⏰ Tiempo agotado. Deteniendo y finalizando sesión.");
            stopAndFinalizeSession(); // Trigger finalization when timer runs out
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
      // Ensure recorder is stopped if timer effect cleans up while recording is active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log("⏰ Timer useEffect cleanup: Stopping active MediaRecorder.");
          mediaRecorderRef.current.stop();
      }
    };
  }, [sessionState, stopAndFinalizeSession]); // Add stopAndFinalizeSession to dependencies

  // Function for the user to retry the session start or activate voice if autoplay was blocked
  const handleAutoplayRetry = useMemoizedFn(async () => {
    console.log("handleAutoplayRetry triggered by user click.");
    setShowAutoplayBlockedMessage(false);

    if (sessionState === StreamingAvatarSessionState.INACTIVE) {
      console.log("Autoplay Retry: Session inactive, attempting full session start with voice.");
      await startSessionV2(true);
    } else if (sessionState === StreamingAvatarSessionState.CONNECTED && !isVoiceChatActive) {
      console.log("Autoplay Retry: Session connected but voice inactive, attempting to start voice chat.");
      await startVoiceChat().catch(e => console.error("Error al iniciar chat de voz al reintentar:", e));
    } else {
      console.log("Autoplay Retry: Session already active or connecting, no further action needed.");
    }
  });

  // Format timer for display
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-4 justify-center items-center mt-4">
        {/* Avatar de HeyGen */}
        <div className="w-full md:w-1/2 relative min-h-[300px] flex items-center justify-center bg-zinc-800 rounded-lg">
          {sessionState !== StreamingAvatarSessionState.INACTIVE ? (
            <AvatarVideo ref={mediaStream} />
          ) : (
            !showAutoplayBlockedMessage && <AvatarConfig config={config} onConfigChange={setConfig} />
          )}

          {showAutoplayBlockedMessage && (
            <div className="absolute inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center text-white text-center p-4 rounded-lg z-30">
              <p className="mb-4 text-lg font-semibold">
                ¡El video y el audio están bloqueados!
              </p>
              <p className="mb-6">
                Tu navegador bloqueó la reproducción automática o el acceso al micrófono.
                Haz clic para comenzar la experiencia.
              </p>
              <Button onClick={handleAutoplayRetry} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">
                Habilitar Video y Audio
              </Button>
              <p className="text-sm mt-4 text-zinc-400">
                (Asegúrate de permitir el acceso al micrófono si se te solicita)
              </p>
            </div>
          )}
          {sessionState === StreamingAvatarSessionState.CONNECTING && !showAutoplayBlockedMessage && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white rounded-lg z-20">
                <LoadingIcon className="w-10 h-10 animate-spin" />
                <span className="ml-2 text-lg">Cargando Avatar...</span>
            </div>
          )}
           {/* Display recording timer when connected */}
           {sessionState === StreamingAvatarSessionState.CONNECTED && (
                <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white text-sm px-3 py-1 rounded-full z-10">
                    Grabando: {formatTime(recordingTimer)}
                </div>
            )}
        </div>

        {/* Cámara del usuario */}
        <div className="w-full md:w-1/2">
          <video
            ref={userCameraRef}
            autoPlay
            muted
            playsInline
            className="rounded-lg border w-full aspect-video object-cover bg-black"
          />
        </div>
      </div>

      {/* Controles de la sesión */}
      <div className="flex flex-col gap-3 items-center justify-center p-4 border-t border-zinc-700 w-full">
        {sessionState === StreamingAvatarSessionState.CONNECTED ? (
          <AvatarControls />
        ) : (
          <div className="flex flex-row gap-4">
            {sessionState === StreamingAvatarSessionState.INACTIVE && !showAutoplayBlockedMessage && !isAttemptingAutoStart && (
              <>
                <Button onClick={() => startSessionV2(true)}>
                  Iniciar Chat de Voz
                </Button>
                <Button onClick={() => startSessionV2(false)}>
                  Iniciar Chat de Texto
                </Button>
              </>
            )}
            {(isAttemptingAutoStart || sessionState === StreamingAvatarSessionState.CONNECTING) && !showAutoplayBlockedMessage && (
                <div className="flex items-center space-x-2 text-white">
                    <LoadingIcon className="w-6 h-6 animate-spin" />
                    <span>Conectando...</span>
                </div>
            )}
            {/* Add a button to manually stop and finalize if needed, e.g., for testing */}
            {sessionState === StreamingAvatarSessionState.CONNECTED && (
                <Button onClick={stopAndFinalizeSession} className="bg-red-600 hover:bg-red-700">
                    Finalizar Sesión
                </Button>
            )}
          </div>
        )}
      </div>

      {sessionState === StreamingAvatarSessionState.CONNECTED && (
        <MessageHistory />
      )}
    </div>
  );
}

// In InteractiveAvatar.tsx
export default function InteractiveAvatarWrapper() {
  console.log("DEBUG: NEXT_PUBLIC_BASE_API_URL is:", process.env.NEXT_PUBLIC_BASE_API_URL);
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL || ""}>
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}