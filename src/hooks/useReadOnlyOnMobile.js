import useIsMobile from './useIsMobile';
import { isReadOnlyOnMobile } from '../config/mobileNavConfig';

// Returns true when the current page should hide all add/edit/delete controls.
// Pages call this and gate their action buttons:
//   const readOnly = useReadOnlyOnMobile('goals');
//   {!readOnly && <AddButton />}
export default function useReadOnlyOnMobile(tabKey) {
  const isMobile = useIsMobile();
  if (!isMobile) return false;
  return isReadOnlyOnMobile(tabKey);
}
