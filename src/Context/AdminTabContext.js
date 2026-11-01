import { createContext, useContext } from 'react';
export const AdminTabContext = createContext(true);
export const useActiveAdminTab = () => useContext(AdminTabContext);
