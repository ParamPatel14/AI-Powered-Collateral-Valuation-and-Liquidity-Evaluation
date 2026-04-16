import { useState } from "react";

function App() {
  const [count, setCount] = useState<number>(0);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
      
      {/* Title */}
      <h1 className="text-4xl font-bold mb-6 text-blue-400">
        🚀 Tailwind + React App
      </h1>

      {/* Card */}
      <div className="bg-gray-800 p-6 rounded-2xl shadow-lg text-center">
        <p className="text-lg mb-4">
          You clicked the button:
        </p>

        <h2 className="text-3xl font-semibold text-green-400 mb-4">
          {count}
        </h2>

        {/* Button */}
        <button
          onClick={() => setCount(count + 1)}
          className="px-6 py-2 bg-blue-500 hover:bg-blue-600 rounded-xl transition duration-300"
        >
          Click Me
        </button>
      </div>

      {/* Footer */}
      <p className="mt-6 text-sm text-gray-400">
        Built with React + Tailwind CSS
      </p>
    </div>
  );
}

export default App;