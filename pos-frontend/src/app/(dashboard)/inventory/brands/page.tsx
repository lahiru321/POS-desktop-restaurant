"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inventoryService } from "@/services/inventoryService";
import { 
  Table, TableBody, TableCell, TableHeader, TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Globe, Search } from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo, useCallback } from "react";
import BrandForm from "@/components/inventory/BrandForm";
import { SortableHeader, SortDirection } from "@/components/ui/SortableHeader";
import { Brand } from "@/types/inventory";
import { useConfirmDialog } from "@/components/super-admin/ConfirmDialog";

export default function BrandsPage() {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    const timeout = setTimeout(() => setDebouncedSearch(value), 300);
    return () => clearTimeout(timeout);
  }, []);

  const { data: brands, isLoading } = useQuery({
    queryKey: ['brands', debouncedSearch],
    queryFn: () => inventoryService.getBrands(),
  });

  // Client-side sort (since brands is a flat list without backend pagination)
  const sortedBrands = useMemo(() => {
    if (!brands) return [];
    if (!sortKey || !sortDirection) return brands;

    return [...brands].sort((a, b) => {
      let valA: string | number, valB: string | number;
      if (sortKey === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortKey === 'createdAt') {
        valA = new Date(a.createdAt).getTime();
        valB = new Date(b.createdAt).getTime();
      } else {
        return 0;
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [brands, sortKey, sortDirection]);

  const deleteMutation = useMutation({
    mutationFn: inventoryService.deleteBrand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      toast.success("Brand deleted");
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to delete brand");
    }
  });

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete this brand?",
      description: "Menu items under this brand will become unbranded. This cannot be undone.",
      confirmLabel: "Delete brand",
      variant: "destructive",
    });
    if (ok) deleteMutation.mutate(id);
  };

  const handleEdit = (brand: Brand) => {
    setEditingBrand(brand);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingBrand(null);
    setIsFormOpen(true);
  };

  const handleSort = (key: string, direction: SortDirection) => {
    setSortKey(direction ? key : null);
    setSortDirection(direction);
  };

  return (
    <div className="p-8 space-y-6">
      {confirmDialog}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brands</h1>
          <p className="text-muted-foreground">Makers of the packaged items you sell.</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus size={18} /> Add Brand
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex gap-4 items-center bg-card/50 p-4 rounded-xl border border-border">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input 
            placeholder="Search brands by name..." 
            className="pl-10 bg-background border-border"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {sortedBrands.length} {sortedBrands.length === 1 ? 'brand' : 'brands'}
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading brands...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent bg-muted/20">
                  <SortableHeader
                    label="Name"
                    sortKey="name"
                    currentSort={sortKey}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Website"
                    sortKey="website"
                    currentSort={sortKey}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Description"
                    sortKey="description"
                    currentSort={sortKey}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Added Date"
                    sortKey="createdAt"
                    currentSort={sortKey}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Actions"
                    sortKey=""
                    currentSort={null}
                    currentDirection={null}
                    onSort={() => {}}
                    className="text-right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedBrands.map((brand: Brand) => (
                  <TableRow key={brand.id} className="border-border hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium text-foreground">{brand.name}</TableCell>
                    <TableCell className="text-primary">
                      {brand.website ? (
                        <a href={brand.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline">
                          <Globe size={14} /> {brand.website.replace(/^https?:\/\//, '')}
                        </a>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[250px]">
                      {brand.description || '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(brand.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${brand.name}`}
                          title="Edit"
                          onClick={() => handleEdit(brand)}
                          className="hover:bg-primary/20 hover:text-primary"
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${brand.name}`}
                          title="Delete"
                          onClick={() => handleDelete(brand.id)}
                          className="hover:bg-destructive/20 hover:text-destructive"
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedBrands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No brands found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
           <Card className="w-full max-w-md bg-card border-border shadow-2xl">
              <CardHeader>
                <CardTitle>{editingBrand ? 'Edit Brand' : 'Create Brand'}</CardTitle>
              </CardHeader>
              <CardContent>
                 <BrandForm 
                    initialData={editingBrand}
                    onSuccess={() => setIsFormOpen(false)}
                    onCancel={() => setIsFormOpen(false)}
                 />
              </CardContent>
           </Card>
        </div>
      )}
    </div>
  );
}
