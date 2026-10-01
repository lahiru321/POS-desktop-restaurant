"use client";

import { useState } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileDown, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { inventoryService } from "@/services/inventoryService";
import { toast } from "sonner";

interface ImportError { rowNumber: number; message: string }
interface ImportResult { successCount: number; failureCount: number; errors: ImportError[] }

interface ImportProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImportProductsModal({ isOpen, onClose, onSuccess }: ImportProductsModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setResult(null);
    try {
      const response = await inventoryService.importProducts(file);
      // Backend returns the count of successfully imported products in the `data` wrapper
      const count = response.data;
      setResult({ successCount: count, failureCount: 0, errors: [] });
      toast.success(`Imported ${count} menu items`);
      onSuccess();
      setTimeout(onClose, 2000);
    } catch (error: unknown) {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to upload file");
    } finally {
      setIsUploading(false);
    }
  };

  const downloadTemplate = () => {
    // A dish (cooked to order, no stock) and a bought-in drink (counted). SKU may
    // stay blank: the server makes one, and matches a re-import by name. A brand
    // column in an older file is still accepted, just no longer offered.
    const headers = "name,category,basePrice,trackStock,stockQuantity,lowStockThreshold,barcode,description,costPrice,sku";
    const examples = [
      "Chicken Kottu,Kottu,1200.00,false,,,,Spicy chicken kottu,650.00,",
      "Coca-Cola 500ml,Drinks,250.00,true,48,12,5449000000996,,180.00,",
    ];
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...examples].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "menu_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-background border-border">
        <DialogHeader>
          <DialogTitle>Import menu items</DialogTitle>
          <DialogDescription>
            Upload a CSV file to add or update menu items in one go. A row matching an existing item (by SKU, or by name when SKU is blank) updates it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div 
            className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center gap-3 hover:border-primary/50 transition-colors cursor-pointer bg-card/20"
            onClick={() => document.getElementById('csv-upload')?.click()}
          >
            <Upload className="text-muted-foreground" size={32} />
            <div className="text-center">
              <p className="text-sm font-medium">{file ? file.name : "Click to select CSV file"}</p>
              <p className="text-xs text-muted-foreground mt-1">Maximum size 5MB</p>
            </div>
            <input 
              id="csv-upload" 
              type="file" 
              accept=".csv" 
              className="hidden" 
              onChange={handleFileChange}
            />
          </div>

          <Button 
            variant="outline" 
            className="w-full gap-2 border-border hover:bg-card"
            onClick={downloadTemplate}
          >
            <FileDown size={18} /> Download CSV Template
          </Button>

          {result && result.failureCount > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-medium">
                <AlertCircle size={18} />
                <span>Import Errors ({result.failureCount})</span>
              </div>
              <div className="max-h-[150px] overflow-y-auto space-y-1">
                {result.errors.map((err: ImportError, idx: number) => (
                  <p key={idx} className="text-xs text-red-300">
                    Row {err.rowNumber}: {err.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {result && result.successCount > 0 && result.failureCount === 0 && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle2 className="text-success" size={24} />
              <div>
                <p className="text-sm font-medium text-success">Import Successful</p>
                <p className="text-xs text-success/80">{result.successCount} menu items were added or updated.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isUploading}>Cancel</Button>
          <Button 
            onClick={handleUpload} 
            disabled={!file || isUploading}
            className="bg-primary hover:bg-primary/90 gap-2"
          >
            {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {isUploading ? "Uploading..." : "Start Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
