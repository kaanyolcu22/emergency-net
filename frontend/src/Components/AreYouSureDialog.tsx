import React, { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/Components/ui/alert-dialog";

type AreYouSureDialogProps = {
  onAccept: () => void;
  title: string;
  children: ReactNode;
  className?: string;
};

const AreYouSureDialog: React.FC<AreYouSureDialogProps> = ({
  onAccept,
  title,
  children,
  className,
}) => {
  const handleWrapperClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div className={className} onClick={handleWrapperClick}>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button 
            onClick={handleWrapperClick} 
            className="p-0 m-0 bg-transparent border-none cursor-pointer"
          >
            {children}
          </button>
        </AlertDialogTrigger>
        
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={onAccept}>Devam Et</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AreYouSureDialog;