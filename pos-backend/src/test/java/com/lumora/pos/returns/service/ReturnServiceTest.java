package com.lumora.pos.returns.service;

import com.lumora.pos.TestUtils;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.service.ProductService;
import com.lumora.pos.returns.dto.ReturnItemRequest;
import com.lumora.pos.returns.dto.ReturnItemResponse;
import com.lumora.pos.returns.dto.ReturnRequest;
import com.lumora.pos.returns.dto.ReturnResponse;
import com.lumora.pos.returns.entity.ReturnEntity;
import com.lumora.pos.returns.repository.ReturnRepository;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.entity.SaleItemEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("ReturnService Unit Tests")
class ReturnServiceTest {

    @Mock
    private ReturnRepository returnRepository;
    @Mock
    private SaleRepository saleRepository;
    @Mock
    private ProductService productService;
    @Mock
    private ProductRepository productRepository;
    @Mock
    private AuditService auditService;
    @Mock
    private UserRepository userRepository;
    @Mock
    private BranchRepository branchRepository;
    @Mock
    private BranchAccessGuard branchAccessGuard;
    @Mock
    private SecurityContext securityContext;
    @Mock
    private Authentication authentication;

    @InjectMocks
    private ReturnService returnService;

    private UUID tenantId;
    private UUID saleId;
    private UUID saleItemId;
    private UUID productId;
    private SaleEntity saleEntity;
    private SaleItemEntity saleItemEntity;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        saleId = UUID.randomUUID();
        saleItemId = UUID.randomUUID();
        productId = UUID.randomUUID();

        TenantContext.setTenantId(tenantId);

        saleItemEntity = new SaleItemEntity();
        saleItemEntity.setId(saleItemId);
        saleItemEntity.setProductId(productId);
        saleItemEntity.setQuantity(new BigDecimal("2.00"));
        saleItemEntity.setTotalAmount(new BigDecimal("100.00"));

        saleEntity = new SaleEntity();
        saleEntity.setId(saleId);
        saleEntity.setTenantId(tenantId);
        saleEntity.setPaymentStatus(SaleEntity.PaymentStatus.PAID);
        saleEntity.setItems(List.of(saleItemEntity));

        BranchEntity mockDefaultBranch = new BranchEntity();
        mockDefaultBranch.setId(UUID.randomUUID());
        lenient().when(branchRepository.findByIsDefaultTrueAndTenantId(any(UUID.class)))
                .thenReturn(Optional.of(mockDefaultBranch));

        SecurityContextHolder.setContext(securityContext);
        lenient().when(securityContext.getAuthentication()).thenReturn(authentication);
        lenient().when(authentication.getPrincipal()).thenReturn(UUID.randomUUID().toString());
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("Should successfully create a return and restore stock")
    void shouldCreateReturnAndRestoreStock() {
        ReturnRequest request = new ReturnRequest();
        request.setSaleId(saleId);
        request.setReason("Refund");
        request.setRefundMethod(ReturnEntity.RefundMethod.CASH);
        
        ReturnItemRequest itemReq = new ReturnItemRequest();
        itemReq.setSaleItemId(saleItemId);
        itemReq.setQuantity(new BigDecimal("1.00")); // Retuning 1 out of 2
        request.setItems(List.of(itemReq));

        when(saleRepository.findByIdAndTenantId(saleId, tenantId)).thenReturn(Optional.of(saleEntity));
        when(returnRepository.findAllBySaleIdAndTenantIdOrderByCreatedAtDesc(saleId, tenantId))
                .thenReturn(Collections.emptyList());

        when(returnRepository.save(any(ReturnEntity.class))).thenAnswer(inv -> {
            ReturnEntity entity = inv.getArgument(0);
            entity.setId(UUID.randomUUID());
            return entity;
        });

        ReturnResponse response = returnService.createReturn(request);

        assertThat(response).isNotNull();
        assertThat(response.getRefundAmount()).isEqualByComparingTo("50.00");
        assertThat(response.getStatus()).isEqualTo(ReturnEntity.ReturnStatus.COMPLETED);
        
        // Ensure stock was restored
        verify(productService, times(1)).updateStock(productId, 1);
        verify(saleRepository, times(1)).save(saleEntity); // Mark as refunded eventually, wait it marks the sale!
        assertThat(saleEntity.getPaymentStatus()).isEqualTo(SaleEntity.PaymentStatus.REFUNDED);
        
        verify(auditService, times(1)).logCreate(eq("RETURN"), any(UUID.class), any());
    }

    @Test
    @DisplayName("Should require approval for high value returns")
    void shouldRequireApprovalForHighValue() {
        // High value return
        saleItemEntity.setQuantity(new BigDecimal("10.00"));
        saleItemEntity.setTotalAmount(new BigDecimal("1000.00"));

        ReturnRequest request = new ReturnRequest();
        request.setSaleId(saleId);
        request.setReason("Refund");
        request.setRefundMethod(ReturnEntity.RefundMethod.ORIGINAL);

        ReturnItemRequest itemReq = new ReturnItemRequest();
        itemReq.setSaleItemId(saleItemId);
        itemReq.setQuantity(new BigDecimal("6.00")); // 600.00 > 500.00 threshold
        request.setItems(List.of(itemReq));

        when(saleRepository.findByIdAndTenantId(saleId, tenantId)).thenReturn(Optional.of(saleEntity));
        
        when(returnRepository.save(any(ReturnEntity.class))).thenAnswer(inv -> {
            ReturnEntity entity = inv.getArgument(0);
            entity.setId(UUID.randomUUID());
            return entity;
        });

        ReturnResponse response = returnService.createReturn(request);

        assertThat(response.getStatus()).isEqualTo(ReturnEntity.ReturnStatus.PENDING);
        // Stock should NOT be restored yet since it's pending
        verify(productService, never()).updateStock(any(), anyInt());
    }

    @Test
    @DisplayName("Should throw exception if returning more than purchased")
    void shouldFailIfQuantityExceedsPurchased() {
        ReturnRequest request = new ReturnRequest();
        request.setSaleId(saleId);
        request.setReason("Refund");

        ReturnItemRequest itemReq = new ReturnItemRequest();
        itemReq.setSaleItemId(saleItemId);
        itemReq.setQuantity(new BigDecimal("3.00")); // purchased 2
        request.setItems(List.of(itemReq));

        when(saleRepository.findByIdAndTenantId(saleId, tenantId)).thenReturn(Optional.of(saleEntity));

        assertThatThrownBy(() -> returnService.createReturn(request))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Cannot return more than purchased");
    }

    @Test
    @DisplayName("Should not restore stock for damaged items")
    void shouldNotRestoreStockForDamagedItems() {
        ReturnRequest request = new ReturnRequest();
        request.setSaleId(saleId);
        // This exact string triggers DAMAGED_WRITEOFF
        request.setReason("Defective / Damaged"); 
        
        ReturnItemRequest itemReq = new ReturnItemRequest();
        itemReq.setSaleItemId(saleItemId);
        itemReq.setQuantity(new BigDecimal("1.00"));
        request.setItems(List.of(itemReq));

        when(saleRepository.findByIdAndTenantId(saleId, tenantId)).thenReturn(Optional.of(saleEntity));
        when(returnRepository.save(any(ReturnEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        ReturnResponse response = returnService.createReturn(request);

        assertThat(response.getReturnType()).isEqualTo(ReturnEntity.ReturnType.DAMAGED_WRITEOFF);
        // Stock should NOT be restored
        verify(productService, never()).updateStock(any(), anyInt());
    }

    @Test
    @DisplayName("Should refund a line with no product without touching stock")
    void shouldRefundLineWithNullProductId() {
        // A topping (V61) and a custom/open line (V49) both carry product_id = NULL.
        // Before the guard this reached findByIdAndTenantId(null) and blew up with
        // "Product not found", so the customer could not be refunded at all.
        UUID toppingItemId = UUID.randomUUID();
        SaleItemEntity toppingItem = new SaleItemEntity();
        toppingItem.setId(toppingItemId);
        toppingItem.setProductId(null);
        toppingItem.setItemName("Extra Cheese");
        toppingItem.setQuantity(new BigDecimal("1.00"));
        toppingItem.setTotalAmount(new BigDecimal("50.00"));
        saleEntity.setItems(List.of(saleItemEntity, toppingItem));

        ReturnRequest request = new ReturnRequest();
        request.setSaleId(saleId);
        request.setReason("Refund");
        request.setRefundMethod(ReturnEntity.RefundMethod.CASH);

        ReturnItemRequest itemReq = new ReturnItemRequest();
        itemReq.setSaleItemId(toppingItemId);
        itemReq.setQuantity(new BigDecimal("1.00"));
        request.setItems(List.of(itemReq));

        when(saleRepository.findByIdAndTenantId(saleId, tenantId)).thenReturn(Optional.of(saleEntity));
        when(returnRepository.findAllBySaleIdAndTenantIdOrderByCreatedAtDesc(saleId, tenantId))
                .thenReturn(Collections.emptyList());
        when(returnRepository.save(any(ReturnEntity.class))).thenAnswer(inv -> {
            ReturnEntity entity = inv.getArgument(0);
            entity.setId(UUID.randomUUID());
            return entity;
        });

        ReturnResponse response = returnService.createReturn(request);

        assertThat(response.getRefundAmount()).isEqualByComparingTo("50.00");
        // Nothing to put back: no catalogue entry, no stock_levels row.
        verify(productService, never()).updateStock(any(), anyInt());
        verify(productService, never()).updateStockForBranch(any(), any(), anyInt(), any());
        // The line names itself, rather than showing as "Unknown Product".
        assertThat(response.getItems()).singleElement()
                .extracting(ReturnItemResponse::getProductName)
                .isEqualTo("Extra Cheese");
    }
}
