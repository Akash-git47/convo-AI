
import React, { useState, useEffect } from 'react';
import Conversation from './components/Conversation';
import ThemeToggle from './components/ThemeToggle';
import { Theme } from './types';

const App: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(Theme.DARK);

  useEffect(() => {
    if (theme === Theme.DARK) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === Theme.LIGHT ? Theme.DARK : Theme.LIGHT);
  };

  return (
    <div className="bg-white dark:bg-black min-h-screen text-slate-800 dark:text-slate-200 transition-colors duration-300 font-sans">
      <header className="absolute top-0 right-0 p-4 z-10">
        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
      </header>
      <main className="container mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-screen">
        <Conversation />
      </main>
    </div>
  );
};

export default App;
