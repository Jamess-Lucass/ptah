import { ThemeProvider } from "@/providers/theme-provider";
import { Home } from "./pages/home";

function App() {
  return (
    <ThemeProvider>
      <Home />
    </ThemeProvider>
  );
}

export default App;
