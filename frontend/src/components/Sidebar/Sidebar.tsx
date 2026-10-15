import { Route } from "lucide-react";
import { useState } from "react";
import { LinesSheet } from "@/baseblocks/LinesSheet/LinesSheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useAppContext } from "@/providers/AppProvider";
import { BuildHashFooter } from "./BuildHashFooter/BuildHashFooter";
import styles from "./Sidebar.module.css";

export const AppSidebar = () => {
  const {
    interpolatedTrainMovement,
    setInterpolatedTrainMovement,
    smoothBackgroundMovement,
    setSmoothBackgroundMovement,
    trainModelsOnMap,
    setTrainModelsOnMap,
  } = useAppContext();
  const [linesOpen, setLinesOpen] = useState(false);

  return (
    <>
      <Sidebar collapsible="icon" className={styles.shell}>
        <SidebarRail />
        <SidebarHeader className={styles.header}>
          <div className={styles.headerRow}>
            <div className={styles.headerTitleCluster}>
              <div className={styles.brandTitleWrap}>
                <p className={styles.brandTitle}>NSW Train Map</p>
              </div>
            </div>
            <SidebarTrigger className={styles.toggleButton} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className={styles.navGroup}>
            <SidebarSeparator />
            <SidebarGroupContent>
              <SidebarMenu className={styles.menu}>
                <SidebarMenuItem className={styles.menuItem}>
                  <SidebarMenuButton
                    isActive={linesOpen}
                    onClick={() => setLinesOpen(true)}
                    className={styles.menuButton}
                  >
                    <Route className={styles.menuButtonIcon} />
                    <div className={styles.menuButtonLabelWrap}>
                      <p className={styles.menuButtonLabel}>Lines</p>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className={styles.optionsFooter}>
          <label className={styles.smoothToggle}>
            <span className={styles.smoothToggleText}>Interpolated train movement</span>
            <input
              type="checkbox"
              className={styles.smoothToggleInput}
              checked={interpolatedTrainMovement}
              onChange={(event) => setInterpolatedTrainMovement(event.target.checked)}
            />
            <span className={styles.smoothToggleSwitch} aria-hidden="true" />
          </label>
          <label className={styles.smoothToggle} data-disabled={!interpolatedTrainMovement}>
            <span className={styles.smoothToggleText}>Smooth background movement</span>
            <input
              type="checkbox"
              className={styles.smoothToggleInput}
              checked={smoothBackgroundMovement}
              disabled={!interpolatedTrainMovement}
              onChange={(event) => setSmoothBackgroundMovement(event.target.checked)}
            />
            <span className={styles.smoothToggleSwitch} aria-hidden="true" />
          </label>
          <label className={styles.smoothToggle}>
            <span className={styles.smoothToggleText}>Use train models on map</span>
            <input
              type="checkbox"
              className={styles.smoothToggleInput}
              checked={trainModelsOnMap}
              onChange={(event) => setTrainModelsOnMap(event.target.checked)}
            />
            <span className={styles.smoothToggleSwitch} aria-hidden="true" />
          </label>
        </SidebarFooter>
        <BuildHashFooter />
      </Sidebar>
      <LinesSheet open={linesOpen} onOpenChange={setLinesOpen} />
    </>
  );
};
