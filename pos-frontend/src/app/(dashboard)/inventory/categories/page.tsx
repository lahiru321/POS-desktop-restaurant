"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inventoryService } from "@/services/inventoryService";
import { 
  Table, TableBody, TableCell, TableHeader, TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo, useCallback } from "react";
import CategoryForm from "@/components/inventory/CategoryForm";
import { SortableHeader, SortDirection } from "@/components/ui/SortableHeader";
import { Category } from "@/types/inventory";
import { useConfirmDialog } from "@/components/super-admin/ConfirmDialog";

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
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

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories', debouncedSearch],
    queryFn: () => inventoryService.getCategories(),
  });

  // Client-side sort (since categories is a flat list without backend pagination)
  const sortedCategories = useMemo(() => {
    if (!categories) return [];
    if (!sortKey || !sortDirection) return categories;

    return [...categories].sort((a, b) => {
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
  }, [categories, sortKey, sortDirection]);

  const deleteMutation = useMutation({
    mutationFn: inventoryService.deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success("Category deleted");
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to delete category");
    }
  });

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete this category?",
      description: "Products in this category will become uncategorized. This cannot be undone.",
      confirmLabel: "Delete category",
      variant: "destructive",
    });
    if (ok) deleteMutation.mutate(id);
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingCategory(null);
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
          <h1 className="text-3xl font-bold tracking-tight">Menu Categories</h1>
          <p className="text-muted-foreground">Sections of your menu. They become the tabs on the till and set tax and kitchen routing.</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus size={18} /> Add Category
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex gap-4 items-center bg-card/50 p-4 rounded-xl border border-border">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input 
            placeholder="Search categories by name..." 
            className="pl-10 bg-background border-border"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {sortedCategories.length} {sortedCategories.length === 1 ? 'category' : 'categories'}
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading categories...</div>
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
                    label="Slug"
                    sortKey="slug"
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
                    label="Parent"
                    sortKey="parentId"
                    currentSort={sortKey}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Tax Rate"
                    sortKey="taxRateName"
                    currentSort={sortKey}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Station"
                    sortKey="kitchenStation"
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
                {sortedCategories.map((category: Category) => (
                  <TableRow key={category.id} className="border-border hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium text-foreground">{category.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{category.slug || '-'}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[200px]">
                      {category.description || '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {category.parentId ? (
                        categories?.find((c: Category) => c.id === category.parentId)?.name || category.parentId
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {category.taxRateName ? (
                        <div className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                          {category.taxRateName}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Default</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {category.kitchenStation ? (
                        <span className="font-mono text-xs text-foreground">{category.kitchenStation}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Kitchen</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${category.name}`}
                          title="Edit"
                          onClick={() => handleEdit(category)}
                          className="hover:bg-primary/20 hover:text-primary"
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${category.name}`}
                          title="Delete"
                          onClick={() => handleDelete(category.id)}
                          className="hover:bg-destructive/20 hover:text-destructive"
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedCategories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No categories found.
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
                <CardTitle>{editingCategory ? 'Edit Category' : 'Create Category'}</CardTitle>
              </CardHeader>
              <CardContent>
                 <CategoryForm 
                    initialData={editingCategory}
                    categories={categories || []}
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
