import React from 'react';

interface VisualizerProps {
  isConnected: boolean;
  isSpeaking: boolean;
  micVolume: number;
}

const Visualizer: React.FC<VisualizerProps> = ({ isConnected, isSpeaking, micVolume }) => {
  const baseClasses = "absolute rounded-full transition-all ease-in-out";
  
  // Conditionally set colors based on the state
  const colorClasses = isSpeaking
    ? "bg-cyan-500/30 dark:bg-cyan-400/30" // Speaking color
    : "bg-blue-500/30 dark:bg-blue-400/30"; // Listening color

  const isListening = isConnected && !isSpeaking;

  // When listening, the scale is dynamic. When speaking, it uses animate-ping. When idle, it's static.
  const listeningStyle = {
    // Use a fast transition for the scale to react to voice quickly
    transform: `scale(${1 + micVolume * 0.4})`,
    transition: 'transform 0.1s ease-out',
  };

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      {/* Outer Circle */}
      <div
        className={`${baseClasses} ${colorClasses} duration-500 ${
          isConnected ? 'w-24 h-24 opacity-100' : 'w-0 h-0 opacity-0'
        } ${isSpeaking ? 'animate-ping' : ''}`}
        style={isListening ? listeningStyle : {}}
      ></div>
      {/* Middle Circle */}
      <div
        className={`${baseClasses} ${colorClasses} duration-500 delay-200 ${
          isConnected ? 'w-20 h-20 opacity-100' : 'w-0 h-0 opacity-0'
        } ${isSpeaking ? 'animate-ping' : ''}`}
        style={isListening ? { ...listeningStyle, transform: `scale(${1 + micVolume * 0.3})` } : {animationDelay: '0.2s'}}
      ></div>
      {/* Inner Circle */}
       <div
        className={`${baseClasses} ${colorClasses} duration-500 delay-500 ${
          isConnected ? 'w-16 h-16 opacity-100' : 'w-0 h-0 opacity-0'
        } ${isSpeaking ? 'animate-ping' : ''}`}
        style={isListening ? { ...listeningStyle, transform: `scale(${1 + micVolume * 0.2})` } : {animationDelay: '0.4s'}}
      ></div>
    </div>
  );
};

export default Visualizer;