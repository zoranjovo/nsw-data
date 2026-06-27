import { Fuel, Route, Train } from "lucide-react";
import type { MouseEvent } from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useAppContext } from "@/providers/AppProvider";
import { BuildHashFooter } from "./BuildHashFooter/BuildHashFooter";
import styles from "./Sidebar.module.css";

const handleTrainsSubNav = (pathname: string, navigate: ReturnType<typeof useNavigate>) => {
  if (pathname !== "/trains") {
    navigate("/trains");
  }
};

const onLinesClick = (
  e: MouseEvent<HTMLAnchorElement>,
  pathname: string,
  navigate: ReturnType<typeof useNavigate>,
  setLinesOpen: (open: boolean) => void
) => {
  e.preventDefault();
  handleTrainsSubNav(pathname, navigate);
  setLinesOpen(true);
};

export const AppSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    interpolatedTrainMovement,
    setInterpolatedTrainMovement,
    smoothInterpolatedTrainMovement,
    setSmoothInterpolatedTrainMovement,
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
                <p className={styles.brandTitle}>NSW Data</p>
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
                    isActive={location.pathname === "/trains"}
                    onClick={() => navigate("/trains")}
                    className={styles.menuButton}
                  >
                    <Train className={styles.menuButtonIcon} />
                    <div className={styles.menuButtonLabelWrap}>
                      <p className={styles.menuButtonLabel}>Trains</p>
                    </div>
                  </SidebarMenuButton>
                  <div className={styles.subMenuIndent}>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          isActive={linesOpen}
                          href="#"
                          onClick={(e) =>
                            onLinesClick(e, location.pathname, navigate, setLinesOpen)
                          }
                        >
                          <Route />
                          <span>Lines</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </div>
                </SidebarMenuItem>
                <SidebarMenuItem className={styles.menuItem}>
                  <SidebarMenuButton
                    isActive={location.pathname === "/fuel"}
                    onClick={() => navigate("/fuel")}
                    className={styles.menuButton}
                  >
                    <Fuel className={styles.menuButtonIcon} />
                    <div className={styles.menuButtonLabelWrap}>
                      <p className={styles.menuButtonLabel}>Fuel</p>
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
            <span className={styles.smoothToggleText}>Smooth interpolated movement</span>
            <input
              type="checkbox"
              className={styles.smoothToggleInput}
              checked={smoothInterpolatedTrainMovement}
              disabled={!interpolatedTrainMovement}
              onChange={(event) => setSmoothInterpolatedTrainMovement(event.target.checked)}
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
