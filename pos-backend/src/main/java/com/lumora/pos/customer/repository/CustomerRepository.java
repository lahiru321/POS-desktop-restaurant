package com.lumora.pos.customer.repository;

import com.lumora.pos.customer.entity.CustomerEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CustomerRepository extends JpaRepository<CustomerEntity, UUID> {

    List<CustomerEntity> findAllByTenantId(UUID tenantId);

    Page<CustomerEntity> findByTenantId(UUID tenantId, Pageable pageable);

    Optional<CustomerEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<CustomerEntity> findByIdInAndTenantId(Collection<UUID> ids, UUID tenantId);

    @Query("SELECT c FROM CustomerEntity c WHERE c.tenantId = :tenantId AND " +
            "(LOWER(c.firstName) LIKE LOWER(CONCAT('%', :query, '%')) OR " +
            "LOWER(c.lastName) LIKE LOWER(CONCAT('%', :query, '%')) OR " +
            "c.phone LIKE CONCAT('%', :query, '%'))")
    Page<CustomerEntity> searchCustomers(UUID tenantId, String query, Pageable pageable);

    /**
     * Customers with a store-credit account — either a limit granted or an
     * outstanding balance owed. Highest balance first for the receivables report.
     */
    @Query("SELECT c FROM CustomerEntity c WHERE c.tenantId = :tenantId AND " +
            "(c.creditLimit > 0 OR c.creditBalance > 0) ORDER BY c.creditBalance DESC")
    Page<CustomerEntity> findCreditAccounts(UUID tenantId, Pageable pageable);
}
