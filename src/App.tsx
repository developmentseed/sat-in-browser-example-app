import AreaPanel from "./components/AreaPanel";
import ControlPanel from "./components/ControlPanel";
import Map from "./components/Map";

export default function App() {
  return (
    <main className="app">
      <Map />
      <ControlPanel />
      <AreaPanel />
    </main>
  );
}
