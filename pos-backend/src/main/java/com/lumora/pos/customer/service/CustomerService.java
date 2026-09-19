package com.lumora.pos.customer.service;

import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.customer.dto.CustomerRequest;
import com.lumora.pos.customer.dto.CustomerResponse;
import com.lumora.pos.customer.entity.CustomerEntity;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class CustomerService {

    private final CustomerRepository customerRepository;

    @Transactional(readOnly = true)
    public Page<CustomerResponse> getAllCustomers(String query, Pageable pageable) {
        UUID tenantId = TenantContext.getTenantId();
        Page<CustomerEntity> customers;

        if (query != null && !query.isEmpty()) {
            customers = customerRepository.searchCustomers(tenantId, query, pageable);
        } else {
            customers = customerRepository.findByTenantId(tenantId, pageable);
        }

        return customers.map(this::mapToResponse);
    }

    @Transactional
    public CustomerResponse createCustomer(CustomerRequest request) {
        CustomerEntity customer = CustomerEntity.builder()
                .firstName(request.getFirstName())
                .lastName(request.getLastName())
                .phone(request.getPhone())
                .email(request.getEmail())
                .address(request.getAddress())
                .loyaltyPoints(0)
                .creditLimit(request.getCreditLimit() != null ? request.getCreditLimit() : java.math.BigDecimal.ZERO)
                .creditBalance(java.math.BigDecimal.ZERO)
                .build();

        customer.setTenantId(TenantContext.getTenantId());
        return mapToResponse(customerRepository.save(customer));
    }

    @Transactional
    public CustomerResponse updateCustomer(UUID id, CustomerRequest request) {
        CustomerEntity customer = customerRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Customer not found"));

        customer.setFirstName(request.getFirstName());
        customer.setLastName(request.getLastName());
        customer.setPhone(request.getPhone());
        customer.setEmail(request.getEmail());
        customer.setAddress(request.getAddress());
        // Null leaves the existing limit untouched; the outstanding balance is never
        // editable here (it only moves through credit sales and repayments).
        if (request.getCreditLimit() != null) {
            customer.setCreditLimit(request.getCreditLimit());
        }

        return mapToResponse(customerRepository.save(customer));
    }

    @Transactional(readOnly = true)
    public CustomerResponse getCustomerById(UUID id) {
        return customerRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .map(this::mapToResponse)
                .orElseThrow(() -> new BusinessException("Customer not found"));
    }

    @Transactional
    public void deleteCustomer(UUID id) {
        CustomerEntity customer = customerRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Customer not found"));
        customerRepository.delete(customer);
    }

    /**
     * Deletes the given customers in one transaction. Only IDs belonging to the
     * caller's tenant are touched (unknown/foreign IDs are silently skipped, never
     * leaked). Returns the number actually deleted.
     */
    @Transactional
    public int bulkDeleteCustomers(List<UUID> ids) {
        List<CustomerEntity> found = customerRepository.findByIdInAndTenantId(ids, TenantContext.getTenantId());
        customerRepository.deleteAll(found);
        return found.size();
    }

    private CustomerResponse mapToResponse(CustomerEntity customer) {
        return CustomerResponse.builder()
                .id(customer.getId())
                .firstName(customer.getFirstName())
                .lastName(customer.getLastName())
                .phone(customer.getPhone())
                .email(customer.getEmail())
                .address(customer.getAddress())
                .loyaltyPoints(customer.getLoyaltyPoints())
                .creditLimit(customer.getCreditLimit())
                .creditBalance(customer.getCreditBalance())
                .createdAt(customer.getCreatedAt())
                .build();
    }
}
