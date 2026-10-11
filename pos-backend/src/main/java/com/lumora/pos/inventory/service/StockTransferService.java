package com.lumora.pos.inventory.service;

import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.dto.StockTransferRequest;
import com.lumora.pos.inventory.dto.StockTransferResponse;
import com.lumora.pos.inventory.entity.StockTransferEntity;
import com.lumora.pos.inventory.entity.StockTransferEntity.TransferStatus;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.entity.StockLevelEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.inventory.repository.StockTransferRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class StockTransferService {

    private final StockTransferRepository stockTransferRepository;
    private final ProductRepository productRepository;
    private final BranchRepository branchRepository;
    private final StockLevelRepository stockLevelRepository;
    private final ProductService productService;
    private final BranchAccessGuard branchAccessGuard;

    @Transactional
    public StockTransferResponse createTransfer(StockTransferRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        // A transfer requires access to the SOURCE branch; stock may be sent to any tenant branch.
        branchAccessGuard.assertCanAccess(request.getSourceBranchId());

        // Validate source and destination are different
        if (request.getSourceBranchId().equals(request.getDestinationBranchId())) {
            throw new BusinessException("Source and destination branches must be different");
        }

        // Validate branches exist and are active
        BranchEntity sourceBranch = branchRepository.findByIdAndTenantId(request.getSourceBranchId(), tenantId)
                .orElseThrow(() -> new BusinessException("Source branch not found"));
        if (!sourceBranch.isActive()) {
            throw new BusinessException("Source branch is inactive");
        }

        BranchEntity destinationBranch = branchRepository
                .findByIdAndTenantId(request.getDestinationBranchId(), tenantId)
                .orElseThrow(() -> new BusinessException("Destination branch not found"));
        if (!destinationBranch.isActive()) {
            throw new BusinessException("Destination branch is inactive");
        }

        // Validate product exists
        ProductEntity product = productRepository.findByIdAndTenantId(request.getProductId(), tenantId)
                .orElseThrow(() -> new BusinessException("Product not found"));
        if (!product.isTrackStock()) {
            throw new BusinessException(product.getName() + " is cooked to order and has no stock to transfer");
        }

        // Validate source branch has sufficient stock
        StockLevelEntity sourceStock = stockLevelRepository
                .findByProductIdAndBranchIdAndTenantId(product.getId(), sourceBranch.getId(), tenantId)
                .orElse(null);

        int availableStock = sourceStock != null ? sourceStock.getQuantity() : 0;
        if (availableStock < request.getQuantity()) {
            throw new BusinessException(
                    String.format("Insufficient stock at %s. Available: %d, Requested: %d",
                            sourceBranch.getName(), availableStock, request.getQuantity()));
        }

        // Create transfer record
        StockTransferEntity transfer = StockTransferEntity.builder()
                .sourceBranch(sourceBranch)
                .destinationBranch(destinationBranch)
                .product(product)
                .quantity(request.getQuantity())
                .status(TransferStatus.PENDING)
                .notes(request.getNotes())
                .build();
        transfer.setTenantId(tenantId);

        StockTransferEntity saved = stockTransferRepository.save(transfer);
        return mapToResponse(saved);
    }

    @Transactional
    public StockTransferResponse updateStatus(UUID transferId, TransferStatus newStatus) {
        UUID tenantId = TenantContext.getTenantId();

        StockTransferEntity transfer = stockTransferRepository.findByIdAndTenantId(transferId, tenantId)
                .orElseThrow(() -> new BusinessException("Stock transfer not found"));

        TransferStatus currentStatus = transfer.getStatus();

        // Validate status transitions
        switch (newStatus) {
            case IN_TRANSIT:
                if (currentStatus != TransferStatus.PENDING) {
                    throw new BusinessException("Only PENDING transfers can be moved to IN_TRANSIT");
                }
                break;
            case COMPLETED:
                if (currentStatus != TransferStatus.PENDING && currentStatus != TransferStatus.IN_TRANSIT) {
                    throw new BusinessException("Only PENDING or IN_TRANSIT transfers can be completed");
                }
                break;
            case CANCELLED:
                if (currentStatus == TransferStatus.COMPLETED) {
                    throw new BusinessException("COMPLETED transfers cannot be cancelled");
                }
                break;
            default:
                throw new BusinessException("Invalid status transition");
        }

        // If completing, perform the actual stock movement
        if (newStatus == TransferStatus.COMPLETED) {
            executeStockMovement(transfer);
            transfer.setCompletedAt(LocalDateTime.now());
        }

        transfer.setStatus(newStatus);
        StockTransferEntity saved = stockTransferRepository.save(transfer);
        return mapToResponse(saved);
    }

    private void executeStockMovement(StockTransferEntity transfer) {
        UUID productId = transfer.getProduct().getId();
        int quantity = transfer.getQuantity();

        // Deduct from source branch
        productService.updateStockForBranch(
                productId,
                transfer.getSourceBranch().getId(),
                -quantity,
                "TRANSFER_OUT to " + transfer.getDestinationBranch().getName());

        // Add to destination branch
        productService.updateStockForBranch(
                productId,
                transfer.getDestinationBranch().getId(),
                quantity,
                "TRANSFER_IN from " + transfer.getSourceBranch().getName());
    }

    @Transactional(readOnly = true)
    public Page<StockTransferResponse> getTransfers(TransferStatus status, Pageable pageable) {
        UUID tenantId = TenantContext.getTenantId();

        Page<StockTransferEntity> page;
        if (status != null) {
            page = stockTransferRepository.findByStatusAndTenantId(status, tenantId, pageable);
        } else {
            page = stockTransferRepository.findAllByTenantId(tenantId, pageable);
        }

        return page.map(this::mapToResponse);
    }

    @Transactional(readOnly = true)
    public StockTransferResponse getTransferById(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        StockTransferEntity transfer = stockTransferRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Stock transfer not found"));
        return mapToResponse(transfer);
    }

    private StockTransferResponse mapToResponse(StockTransferEntity entity) {
        return StockTransferResponse.builder()
                .id(entity.getId())
                .sourceBranchId(entity.getSourceBranch().getId())
                .sourceBranchName(entity.getSourceBranch().getName())
                .destinationBranchId(entity.getDestinationBranch().getId())
                .destinationBranchName(entity.getDestinationBranch().getName())
                .productId(entity.getProduct().getId())
                .productName(entity.getProduct().getName())
                .productSku(entity.getProduct().getSku())
                .quantity(entity.getQuantity())
                .status(entity.getStatus().name())
                .notes(entity.getNotes())
                .completedAt(entity.getCompletedAt())
                .createdAt(entity.getCreatedAt())
                .build();
    }
}
