import { Menu } from "lucide-react";
import { LoaderBar } from "@/baseblocks/LoaderBar/LoaderBar";
import { MapView } from "@/baseblocks/MapView/MapView";
import { SelectionInfoPanel } from "@/baseblocks/SelectionInfoPanel/SelectionInfoPanel";
import { AppSidebar } from "@/components/Sidebar/Sidebar";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";

const MobileTrigger = () => {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="secondary"
      size="icon"
      className="absolute left-3 top-3 z-20 md:hidden shadow-md"
      onClick={toggleSidebar}
    >
      <Menu />
      <span className="sr-only">Open menu</span>
    </Button>
  );
};

const App = () => {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset className="relative">
        <MobileTrigger />
        <LoaderBar />
        <div className="flex-1 overflow-hidden">
          <MapView />
        </div>
      </SidebarInset>
      <SelectionInfoPanel />
    </SidebarProvider>
  );
};

export default App;
